const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config()

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const port = process.env.PORT || 3000

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.r81fqjh.mongodb.net/?appName=Cluster0`;

// Middleware
app.use(express.json());
app.use(cors());

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        const db = client.db('city_fix_db');
        const issuesCollection = db.collection('issues');
        const usersCollection = db.collection('users');

        // ===================================================================
        // ⭐ FIXED — CREATE USER (email based, no uid needed)
        // ===================================================================
        app.post('/users', async (req, res) => {
            const user = req.body;

            if (!user.email) {
                return res.status(400).send({ message: "Email is required" });
            }

            // Check if user already exists by email
            const existingUser = await usersCollection.findOne({ email: user.email });

            if (existingUser) {
                return res.send({ message: "User already exists", inserted: false });
            }

            // ⭐ Assign default role if not provided
            user.role = user.role || "citizen";

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // ===================================================================
        // ⭐ FIXED — GET USER BY EMAIL (matches your frontend)
        // Frontend calls /users/:email → so keep this
        // ===================================================================
        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;

            const user = await usersCollection.findOne({ email });

            if (!user) {
                return res.status(404).send({ message: "User not found" });
            }

            res.send(user);
        });

        // ===================================================================
        // GET ALL USERS
        // ===================================================================
        app.get('/users', async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        // ===================================================================
        // ISSUES: ADD + GET
        // ===================================================================
        app.get('/issues', async (req, res) => {
            const result = await issuesCollection.find().toArray();
            res.send(result);
        });

        app.post('/issues', async (req, res) => {
            const issue = req.body;
            const result = await issuesCollection.insertOne(issue);
            res.send(result);
        });

        await client.db("admin").command({ ping: 1 });
        console.log("Connected to MongoDB Successfully!");
    } finally {
        // keep connection open for server runtime
    }
}

run().catch(console.dir);

// Root
app.get('/', (req, res) => {
    res.send('CityFix backend is running...');
})

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
