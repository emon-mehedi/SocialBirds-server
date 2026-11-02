import express from 'express';
import cors from 'cors';
import 'dotenv/config'
import { MongoClient, ObjectId } from 'mongodb';
import { createRemoteJWKSet, jwtVerify } from 'jose';
const app = express();
const port = process.env.PORT||6000;

//middleware
app.use(cors());
app.use(express.json());

//connecting to mongodb
const client = new MongoClient(process.env.MONGO_CLIENT_URI);
export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } catch (err) {
    console.dir(err);
  }
}

//accessing mongodb collection
const connectedClient =await connectToMongoDB();
const db = connectedClient.db('SocialBirds');
const events= db.collection('events');
const joinedEvents= db.collection('joinedEvents')

//jwk section
const JWKS = createRemoteJWKSet(new URL(`${process.env.AUTH_URL}/api/auth/jwks`));
const verifyJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send({ message: 'Unauthorized: token missing' });
  }
  const token = authHeader.split(' ')[1];

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: process.env.AUTH_URL,
      audience: process.env.AUTH_URL,
    });

    req.user = payload;
    next();
  } catch (err) {
    console.log('JWT verification failed:', err.message);
    return res.status(401).send({ message: 'Unauthorized: invalid or expired token' });
  }
};


//accessing events from mongodb
app.get('/events',async(req,res)=>{
  const cursor = events.find({});
  const allEvents = await cursor.toArray();
  res.send(allEvents)
})


//storing events in mongodb
app.post('/events', verifyJWT, async (req, res) => {
  // CHANGED: email comes from the verified token, not from the client,
  // so nobody can create an event in someone else's name.
  const newEvent = { ...req.body, email: req.user.email };
  console.log("adding new event", newEvent);
  const result = await events.insertOne(newEvent);
  res.send(result)
})

//making dynamic events
app.get('/events/:id', async (req, res) => {
  console.log('params in the server', req.params);
  const id = req.params.id;
  const querry = { _id: new ObjectId(id) };
  const result = await events.findOne(querry);
  res.send(result)
})

//deleting dynamic events
app.delete('/events/:id', verifyJWT, async (req, res) => {
  const id = req.params.id;
  const querry = { _id: new ObjectId(id), email: req.user.email };
  const result = await events.deleteOne(querry);
  if (result.deletedCount === 0) {
    return res.status(403).send({ message: 'Event not found or it is not your event' });
  }
  res.send(result)
})

//updating dynamic events
app.patch('/events/:id', verifyJWT, async (req, res) => {
  const id = req.params.id;
  const updatedEvent = req.body;
  console.log('updating event with id', id, 'with data', updatedEvent);
  const filter = { _id: new ObjectId(id), email: req.user.email };
  const updateDoc = {
    $set: {
      title: updatedEvent.title,
      description: updatedEvent.description,
      category: updatedEvent.category,
      thumbnailImageUrl: updatedEvent.thumbnailImageUrl,
      location: updatedEvent.location,
      date: updatedEvent.date
    }
  }
  const result = await events.updateOne(filter, updateDoc);
  if (result.matchedCount === 0) {
    return res.status(403).send({ message: 'Event not found or it is not your event' });
  }
  res.send(result)
})


//get my events from mongodb
app.get("/myEvents", verifyJWT, async (req, res) => {
  const result = await events.find({ email: req.user.email }).toArray();
  res.send(result);
});



// all events the logged-in user joined
app.get("/joinedEvents", verifyJWT, async (req, res) => {
  const joined = await joinedEvents.find({ email: req.user.email }).toArray();
  const eventIds = joined.map((j) => new ObjectId(j.eventId));
  const result = await events.find({ _id: { $in: eventIds } }).toArray();
  res.send(result);
});

app.get("/joinedEvents/check/:eventId", verifyJWT, async (req, res) => {
  const found = await joinedEvents.findOne({
    eventId: req.params.eventId,
    email: req.user.email,
  });
  res.send({ joined: !!found });
});

// join an event
app.post('/joinedEvents', verifyJWT, async (req, res) => {
  const { eventId } = req.body;
  const email = req.user.email;
  console.log("joining event", eventId, "for", email);

  if (!ObjectId.isValid(eventId)) {
    return res.status(400).send({ message: 'Invalid event id' });
  }
  const event = await events.findOne({ _id: new ObjectId(eventId) });
  if (!event) {
    return res.status(404).send({ message: 'Event not found' });
  }

  // search first: only add if this user has not joined this event yet
  const alreadyJoined = await joinedEvents.findOne({ eventId, email });
  if (alreadyJoined) {
    return res.send({ joined: true, message: 'Already joined' });
  }

  const result = await joinedEvents.insertOne({ eventId, email, joinedAt: new Date() });
  res.send(result)
})

// cancel joining
app.delete('/joinedEvents/:eventId', verifyJWT, async (req, res) => {
  const result = await joinedEvents.deleteOne({
    eventId: req.params.eventId,
    email: req.user.email,
  });
  res.send(result)
})


app.get('/', (req,res)=>{
  res.send('Welcome to SocialBirds')
})

app.listen(port,()=>{
  console.log(`App is listening on port ${port}`);
})

export default app
