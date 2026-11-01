import express from 'express';
import cors from 'cors';
import 'dotenv/config'
import { MongoClient, ObjectId } from 'mongodb';

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

//accessing events from mongodb
app.get('/events',async(req,res)=>{
  const cursor = events.find({});
  const allEvents = await cursor.toArray();
  res.send(allEvents)
})


//storing events in mongodb
app.post('/events', async (req, res) => {
  const newEvent = req.body;
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
app.delete('/events/:id', async (req, res) => {
  const id = req.params.id;
  const querry = { _id: new ObjectId(id) };
  const result = await events.deleteOne(querry);
  res.send(result)
})

//updating dynamic events
app.patch('/events/:id', async (req, res) => {
  const id = req.params.id;
  const updatedEvent = req.body;
  console.log('updating event with id', id, 'with data', updatedEvent);
  const filter = { _id: new ObjectId(id) };
  const options = { upsert: true };
  const updateDoc = {
    $set: {
      title: updatedEvent.title,
      description: updatedEvent.description,
      eventType: updatedEvent.eventType,
      thumbnailImageUrl: updatedEvent.thumbnailImageUrl,
      location: updatedEvent.location,
      eventDate: updatedEvent.eventDate
    }
  }
  const result = await events.updateOne(filter, updateDoc, options);
  res.send(result)
})


//get my events from mongodb
app.get("/myEvents/:email", async (req, res) => {
  const { email } = req.params;
  const result = await events.find({ email: email }).toArray();
  res.send(result);
});


app.get('/', (req,res)=>{
  res.send('Welcome to SocialBirds')
})

app.listen(port,()=>{
  console.log(`App is listening on port ${port}`);
})
