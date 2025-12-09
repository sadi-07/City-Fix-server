const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config()

const { MongoClient, ServerApiVersion } = require('mongodb');

const port = process.env.PORT || 3000

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.r81fqjh.mongodb.net/?appName=Cluster0`;


//middleware
app.use(express.json());
app.use(cors());

// city_fix_user
// 3M8LEVztyPSzTDAs

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('city_fix_db');
        const issuesCollection = db.collection('issues');
        const usersCollection = db.collection('users');

        // CREATE USER
        app.post('/users', async (req, res) => {
            const user = req.body;

            const existingUser = await usersCollection.findOne({ email: user.email });

            if (existingUser) {
                return res.status(400).send({ message: 'User already exists' });
            }

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // GET ALL USERS
        app.get('/users', async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        // GET USER BY EMAIL
        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email });

            if (!user) {
                return res.status(404).send({ message: 'User not found' });
            }

            res.send(user);
        });


        app.get('/issues', async (req, res) => {

        })

        app.post('/issues', async (req, res) => {
            const issue = req.body;
            const result = await issuesCollection.insertOne(issue)

            res.send(result)
        })





        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        //await client.close();
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
