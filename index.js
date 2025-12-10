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


        // ===============================
        // ADMIN DASHBOARD STATISTICS
        // ===============================
        app.get("/admin/stats", async (req, res) => {
            try {
                const totalIssues = await issuesCollection.countDocuments();
                const pendingIssues = await issuesCollection.countDocuments({ status: "Pending" });
                const resolvedIssues = await issuesCollection.countDocuments({ status: "Resolved" });
                const rejectedIssues = await issuesCollection.countDocuments({ status: "Rejected" });

                const boostedIssues = await issuesCollection.countDocuments({ priority: "High" });

                const totalUsers = await usersCollection.countDocuments();

                // Sum payment amounts
                const payments = await paymentsCollection.find().toArray();
                const totalPayments = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

                res.send({
                    totalIssues,
                    pendingIssues,
                    resolvedIssues,
                    rejectedIssues,
                    boostedIssues,
                    totalUsers,
                    totalPayments
                });

            } catch (error) {
                res.status(500).send(error.message);
            }
        });

        // Latest 5 Issues
        app.get("/admin/latest-issues", async (req, res) => {
            const issues = await issuesCollection
                .find()
                .sort({ created_at: -1 })
                .limit(5)
                .toArray();
            res.send(issues);
        });

        // Latest 5 Payments
        app.get("/admin/latest-payments", async (req, res) => {
            const payments = await paymentsCollection
                .find()
                .sort({ created_at: -1 })
                .limit(5)
                .toArray();
            res.send(payments);
        });

        // Latest 5 Users
        app.get("/admin/latest-users", async (req, res) => {
            const users = await usersCollection
                .find()
                .sort({ created_at: -1 })
                .limit(5)
                .toArray();
            res.send(users);
        });

        // PATCH: Block or Unblock a user
        app.patch("/users/block/:email", async (req, res) => {
            const email = req.params.email;
            const { blocked } = req.body;

            const result = await usersCollection.updateOne(
                { email },
                { $set: { blocked } }
            );

            res.send({ success: true, blocked });
        });

        // PATCH: Update staff info
        app.patch("/staff/:email", async (req, res) => {
            const email = req.params.email;
            const updateData = req.body;

            const result = await usersCollection.updateOne(
                { email },
                { $set: updateData }
            );

            res.send({ success: true });
        });


        app.patch("/issues/assign-staff/:id", async (req, res) => {
            const { staff } = req.body;
            const id = req.params.id;

            const staffInfo = await usersCollection.findOne({ _id: new ObjectId(staff) });

            await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        assignedStaff: {
                            id: staffInfo._id,
                            name: staffInfo.name,
                            email: staffInfo.email,
                        },
                    },
                    $push: {
                        timeline: {
                            status: "Assigned",
                            message: `Assigned to staff: ${staffInfo.name}`,
                            updatedBy: "Admin",
                            date: new Date(),
                        },
                    },
                }
            );

            res.send({ success: true });
        });


        app.patch("/issues/reject/:id", async (req, res) => {
            const id = req.params.id;

            await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: { status: "rejected" },
                    $push: {
                        timeline: {
                            status: "Rejected",
                            message: "Issue rejected by admin",
                            updatedBy: "Admin",
                            date: new Date(),
                        },
                    },
                }
            );

            res.send({ success: true });
        });


        // PATCH admin profile by email
        app.patch("/users/admin/:email", async (req, res) => {
            try {
                const email = req.params.email;
                const { name, photoURL } = req.body;

                const result = await usersCollection.findOneAndUpdate(
                    { email, role: "admin" },
                    { $set: { name, photoURL } },
                    { returnDocument: "after" }
                );

                if (!result.value) return res.status(404).send("Admin not found");

                res.send(result.value);
            } catch (err) {
                res.status(500).send(err.message);
            }
        });



        // DELETE staff
        app.delete("/staff/:email", async (req, res) => {
            const email = req.params.email;

            const result = await usersCollection.deleteOne({ email });

            res.send({ success: true });
        });



        // ===============================
        // STAFF DASHBOARD STATISTICS
        // ===============================


        app.patch("/users/:email", async (req, res) => {
            try {
                const email = req.params.email;
                const updatedFields = req.body;
                const result = await usersCollection.updateOne(
                    { email },
                    { $set: updatedFields }
                );
                res.send(result);
            } catch (err) {
                res.status(500).send(err.message);
            }
        });


        // Get all issues assigned to a staff
        app.get("/issues/assigned/:staffEmail", async (req, res) => {
            const staffEmail = req.params.staffEmail;
            const issues = await issuesCollection
                .find({ assignedStaff: staffEmail })
                .sort({ priority: -1 }) // Boosted/high priority first
                .toArray();
            res.send(issues);
        });

        // Update issue status & add timeline record
        app.patch("/issues/status/:id", async (req, res) => {
            try {
                const issueId = req.params.id;
                const { status, updatedBy } = req.body;

                const issue = await issuesCollection.findOne({ _id: new ObjectId(issueId) });
                if (!issue) return res.status(404).send("Issue not found");

                const validFlow = {
                    Pending: ["In-Progress"],
                    "In-Progress": ["Working"],
                    Working: ["Resolved"],
                    Resolved: ["Closed"],
                };

                if (!validFlow[issue.status]?.includes(status)) {
                    return res.status(400).send("Invalid status transition");
                }

                await issuesCollection.updateOne(
                    { _id: new ObjectId(issueId) },
                    {
                        $set: { status },
                        $push: {
                            timeline: {
                                status,
                                message: `Status changed to ${status}`,
                                updatedBy,
                                time: new Date(),
                            },
                        },
                    }
                );

                const updatedIssue = await issuesCollection.findOne({ _id: new ObjectId(issueId) });
                res.send(updatedIssue);
            } catch (err) {
                res.status(500).send(err.message);
            }
        });



        // ===============================
        // CITIZEN DASHBOARD STATISTICS
        // ===============================

        // GET /issues?email=userEmail
        app.get("/issues", async (req, res) => {
            const { email } = req.query;
            let query = {};
            if (email) query.email = email;

            const issues = await issuesCollection.find(query).toArray();
            res.send(issues);
        });


        // GET /payments?email=userEmail
        app.get("/payments", async (req, res) => {
            const { email } = req.query;
            let query = {};
            if (email) query.email = email;

            const payments = await paymentsCollection.find(query).toArray();
            res.send(payments);
        });

        // GET /issues?email=userEmail
        app.get("/issues", async (req, res) => {
            const { email } = req.query;
            const query = email ? { email } : {};
            const issues = await issuesCollection.find(query).toArray();
            res.send(issues);
        });


        // PATCH /issues/:id
        app.patch("/issues/:id", async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;
            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });

            if (!issue) return res.status(404).send("Issue not found");
            if (issue.email !== updatedData.email && updatedData.email) {
                return res.status(403).send("Not allowed to update this issue");
            }

            await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedData }
            );

            const updatedIssue = await issuesCollection.findOne({ _id: new ObjectId(id) });
            res.send(updatedIssue);
        });

        app.post("/issues", async (req, res) => {
            try {
                const issue = req.body;
                issue.createdAt = new Date();
                const result = await issuesCollection.insertOne(issue);
                res.send(result);
            } catch (err) {
                res.status(500).send(err.message);
            }
        });


        app.patch("/users/:email", async (req, res) => {
            try {
                const email = req.params.email;
                const updatedFields = req.body;
                const result = await usersCollection.updateOne(
                    { email },
                    { $set: updatedFields }
                );
                res.send(result);
            } catch (err) {
                res.status(500).send(err.message);
            }
        });




        // DELETE /issues/:id
        app.delete("/issues/:id", async (req, res) => {
            const id = req.params.id;
            await issuesCollection.deleteOne({ _id: new ObjectId(id) });
            res.send({ success: true });
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
