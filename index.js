const express = require('express')
const cors = require('cors')
const app = express()
require('dotenv').config()

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.r81fqjh.mongodb.net/?appName=Cluster0`;

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

        // ==========================================================
        // USERS
        // ==========================================================
        app.post('/users', async (req, res) => {
            const user = req.body;

            if (!user.email) {
                return res.status(400).send({ message: "Email is required" });
            }

            const existingUser = await usersCollection.findOne({ email: user.email });
            if (existingUser) {
                return res.send({ message: "User already exists", inserted: false });
            }

            user.role = user.role || "citizen";

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users', async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.get('/users/:email', async (req, res) => {
            const email = req.params.email;
            const user = await usersCollection.findOne({ email });

            if (!user) {
                return res.status(404).send({ message: "User not found" });
            }

            res.send(user);
        });

        // ==========================================================
        // ISSUES
        // ==========================================================

        // GET all issues
        app.get('/issues', async (req, res) => {
            const result = await issuesCollection.find().toArray();
            res.send(result);
        });

        // CREATE issue — also add a CREATED timeline entry
        app.post('/issues', async (req, res) => {
            const issue = req.body;

            issue.upvoteCount = 0;
            issue.upvotedBy = [];
            issue.timeline = [
                {
                    status: "Created",
                    message: "Issue reported",
                    updatedBy: issue.email,
                    time: new Date()
                }
            ];

            const result = await issuesCollection.insertOne(issue);
            res.send(result);
        });

        // GET single issue
        app.get('/issues/:id', async (req, res) => {
            const id = req.params.id;
            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
            res.send(issue);
        });

        // ==========================================================
        // ⭐ UPVOTE + TIMELINE UPDATE
        // ==========================================================

        app.patch("/issues/upvote/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const { userEmail } = req.body;

                const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });

                if (!issue) return res.status(404).send({ message: "Issue not found" });

                // ❌ Prevent upvoting own issue
                if (issue.email === userEmail) {
                    return res.status(400).send({ message: "You cannot upvote your own issue" });
                }

                // ❌ Prevent multiple upvotes
                if (issue.upvotedBy && issue.upvotedBy.includes(userEmail)) {
                    return res.status(400).send({ message: "Already upvoted" });
                }

                // ⭐ Update upvote count + add timeline + register user in upvotedBy
                await issuesCollection.updateOne(
                    { _id: new ObjectId(id) },
                    {
                        $inc: { upvoteCount: 1 },
                        $push: {
                            upvotedBy: userEmail,
                            timeline: {
                                status: "Upvoted",
                                message: `${userEmail} upvoted this issue`,
                                updatedBy: userEmail,
                                time: new Date()
                            }
                        }
                    }
                );

                // Return updated issue
                const updatedIssue = await issuesCollection.findOne({ _id: new ObjectId(id) });
                res.send({ updatedIssue });

            } catch (error) {
                res.status(500).send(error.message);
            }
        });


        // ==========================================================
        // OPTIONAL: STATUS UPDATE + TIMELINE
        // ==========================================================

        app.patch("/issues/status/:id", async (req, res) => {
            const id = req.params.id;
            const { newStatus, updatedBy } = req.body;

            await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: { status: newStatus },
                    $push: {
                        timeline: {
                            status: newStatus,
                            message: `Status changed to ${newStatus}`,
                            updatedBy,
                            time: new Date()
                        }
                    }
                }
            );

            const updated = await issuesCollection.findOne({ _id: new ObjectId(id) });
            res.send(updated);
        });

        // ==========================================================
        // END
        // ==========================================================

        await client.db("admin").command({ ping: 1 });
        console.log("Connected to MongoDB Successfully!");
    } finally { }
}

run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('CityFix backend is running...');
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
