import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { MongoClient, ObjectId } from 'mongodb';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_CLIENT_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log('You successfully connected to MongoDB!');
    return client;
  } catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const db = connectedClient.db('SocialBirds');
const events = db.collection('events');
const joinedEvents = db.collection('joinedEvents');

// A user can only join the same event once
try {
  await joinedEvents.createIndex({ eventId: 1, email: 1 }, { unique: true });
} catch (err) {
  console.log('Could not create index:', err.message);
}

// JWT verification. token created by BetterAuth on client side
// AUTH_URL = URL of the CLIENT app
const AUTH_URL = (process.env.AUTH_URL || '').replace(/\/$/, '');
const JWKS = createRemoteJWKSet(new URL(`${process.env.AUTH_URL}/api/auth/jwks`));

const verifyJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ message: 'Unauthorized: token missing' });
  }
  const token = authHeader.split(' ')[1];

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: AUTH_URL,
      audience: AUTH_URL,
    });
    req.user = payload; // payload has the logged in user's email, name, id...
    next();
  } catch (err) {
    console.log('JWT verification failed:', err.message);
    return res.status(401).send({ message: 'Unauthorized: invalid or expired token' });
  }
};

//helper functions
function todayString() {
  return new Date().toISOString().slice(0, 10);
}

// Checks the event data sent by the client.
function validateEvent(body) {
  const title = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();
  const category = String(body.category ?? '').trim();
  const thumbnailImageUrl = String(body.thumbnailImageUrl ?? '').trim();
  const location = String(body.location ?? '').trim();
  const date = String(body.date ?? '').trim();

  const errors = [];

  if (title.length < 3) errors.push('Title must be at least 3 characters');
  if (description.length < 10) errors.push('Description must be at least 10 characters');
  if (!category) errors.push('Event type is required');
  if (!location) errors.push('Location is required');

  // thumbnail must be a real http/https link
  try {
    const url = new URL(thumbnailImageUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error();
  } catch {
    errors.push('Thumbnail must be a valid image URL');
  }

  // date must look like 2026-11-20
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    errors.push('Date is not valid');
  }

  return {
    errors,
    data: { title, description, category, thumbnailImageUrl, location, date },
  };
}


app.get('/events', async (req, res) => {
  const limit = parseInt(req.query.limit) || 0; // 0 means "no limit"
  const query = { date: { $gte: todayString() } };

  const result = await events.find(query).sort({ date: 1 }).limit(limit).toArray();
  res.send(result);
});

// Create an event (logged in users only)
app.post('/events', verifyJWT, async (req, res) => {
  const { errors, data } = validateEvent(req.body);

  if (errors.length > 0) {
    return res.status(400).send({ message: errors[0], errors });
  }
  if (data.date < todayString()) {
    return res.status(400).send({ message: 'Event date must be today or in the future' });
  }

  const newEvent = {
    ...data,
    // email and name come from the verified token, not from the client,
    // so nobody can create an event in someone else's name.
    email: req.user.email,
    creatorName: req.user.name,
    createdAt: new Date(),
  };

  const result = await events.insertOne(newEvent);
  res.send(result);
});

// One event (public). Also tells how many people joined.
app.get('/events/:id', async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) {
    return res.status(404).send({ message: 'Event not found' });
  }

  const event = await events.findOne({ _id: new ObjectId(id) });
  if (!event) {
    return res.status(404).send({ message: 'Event not found' });
  }

  const participants = await joinedEvents.countDocuments({ eventId: id });
  res.send({ ...event, participants });
});

// Update an event (only the owner can do it)
app.patch('/events/:id', verifyJWT, async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) {
    return res.status(404).send({ message: 'Event not found' });
  }

  const filter = { _id: new ObjectId(id), email: req.user.email };
  const existing = await events.findOne(filter);
  if (!existing) {
    return res.status(403).send({ message: 'Event not found or it is not your event' });
  }

  const { errors, data } = validateEvent(req.body);
  if (errors.length > 0) {
    return res.status(400).send({ message: errors[0], errors });
  }
  // A new date can't be in the past 
  if (data.date !== existing.date && data.date < todayString()) {
    return res.status(400).send({ message: 'Event date must be today or in the future' });
  }

  const result = await events.updateOne(filter, { $set: data });
  res.send(result);
});

// Delete an event 
app.delete('/events/:id', verifyJWT, async (req, res) => {
  const id = req.params.id;
  if (!ObjectId.isValid(id)) {
    return res.status(404).send({ message: 'Event not found' });
  }

  const result = await events.deleteOne({ _id: new ObjectId(id), email: req.user.email });
  if (result.deletedCount === 0) {
    return res.status(403).send({ message: 'Event not found or it is not your event' });
  }

  // also remove the "joined" records of this event
  await joinedEvents.deleteMany({ eventId: id });
  res.send(result);
});

// Events created by the logged in user 
app.get('/myEvents', verifyJWT, async (req, res) => {
  const result = await events.find({ email: req.user.email }).sort({ date: 1 }).toArray();
  res.send(result);
});



// All events the logged in user joined
app.get('/joinedEvents', verifyJWT, async (req, res) => {
  const joined = await joinedEvents.find({ email: req.user.email }).toArray();
  const eventIds = joined
    .filter((j) => ObjectId.isValid(j.eventId))
    .map((j) => new ObjectId(j.eventId));

  const result = await events.find({ _id: { $in: eventIds } }).sort({ date: 1 }).toArray();
  res.send(result);
});

// Did this user already join this event?
app.get('/joinedEvents/check/:eventId', verifyJWT, async (req, res) => {
  const found = await joinedEvents.findOne({
    eventId: req.params.eventId,
    email: req.user.email,
  });
  res.send({ joined: !!found });
});

// Join an event
app.post('/joinedEvents', verifyJWT, async (req, res) => {
  const { eventId } = req.body;
  const email = req.user.email;

  if (!ObjectId.isValid(eventId)) {
    return res.status(400).send({ message: 'Invalid event id' });
  }
  const event = await events.findOne({ _id: new ObjectId(eventId) });
  if (!event) {
    return res.status(404).send({ message: 'Event not found' });
  }
  if (event.date < todayString()) {
    return res.status(400).send({ message: 'This event has already ended' });
  }

  // search 
  const alreadyJoined = await joinedEvents.findOne({ eventId, email });
  if (alreadyJoined) {
    return res.send({ joined: true, message: 'Already joined' });
  }

  const result = await joinedEvents.insertOne({
    eventId,
    email,
    userName: req.user.name,
    eventTitle: event.title,
    joinedAt: new Date(),
  });
  res.send(result);
});

// Cancel joining
app.delete('/joinedEvents/:eventId', verifyJWT, async (req, res) => {
  const result = await joinedEvents.deleteOne({
    eventId: req.params.eventId,
    email: req.user.email,
  });
  res.send(result);
});

app.get('/', (req, res) => {
  res.send('Welcome to SocialBirds');
});

// If something crashes, send a JSON message instead of an HTML error page
app.use((err, req, res, next) => {
  console.log('Server error:', err.message);
  res.status(500).send({ message: 'Something went wrong on the server' });
});

app.listen(port, () => {
  console.log(`App is listening on port ${port}`);
});

export default app;
