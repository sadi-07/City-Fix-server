const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// =========================
// DATABASE CONNECT
// =========================
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.r81fqjh.mongodb.net/?retryWrites=true&w=majority`;

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

        const db = client.db("city_fix_db");

        const usersCollection = db.collection("users");
        const issuesCollection = db.collection("issues");
        const paymentsCollection = db.collection("payments"); // empty for now

        // ==========================================================
        // USERS (Citizen + Staff + Admin)
        // ==========================================================

        // Create User
        app.post('/users', async (req, res) => {
            const user = req.body;

            if (!user.email) {
                return res.status(400).send({ message: "Email required" });
            }

            const exists = await usersCollection.findOne({ email: user.email });
            if (exists) return res.send({ inserted: false, message: "User already exists" });

            user.role = user.role || "citizen";
            user.blocked = false;
            user.premium = false;
            user.created_at = new Date();

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        // Get All Users
        // app.get('/users', async (req, res) => {
        //     const result = await usersCollection.find().toArray();
        //     res.send(result);
        // });

        app.get('/users', async (req, res) => {
            const role = req.query.role;

            const query = role ? { role } : {}; // if ?role=staff → filter only staff

            const result = await usersCollection.find(query).toArray();
            res.send(result);
        });


        // Get User by Email
        app.get('/users/:email', async (req, res) => {
            const user = await usersCollection.findOne({ email: req.params.email });
            if (!user) return res.status(404).send({ message: "User not found" });
            res.send(user);
        });

        // Block/Unblock user
        app.patch('/users/block/:email', async (req, res) => {
            const { blocked } = req.body;
            const result = await usersCollection.updateOne(
                { email: req.params.email },
                { $set: { blocked } }
            );
            res.send({ success: true });
        });

        // Update staff/admin profile
        app.patch("/users/update/:email", async (req, res) => {
            const email = req.params.email;
            const updateData = req.body;

            await usersCollection.updateOne(
                { email },
                { $set: updateData }
            );

            const updated = await usersCollection.findOne({ email });
            res.send(updated);
        });

        // ==========================================================
        // ISSUES
        // ==========================================================





        // Get issues (all or by email)
        app.get("/issues", async (req, res) => {
            const { email } = req.query;
            const query = email ? { email } : {};
            const issues = await issuesCollection.find(query).toArray();
            res.send(issues);
        });

        // Get single issue
        app.get("/issues/:id", async (req, res) => {
            const issue = await issuesCollection.findOne({ _id: new ObjectId(req.params.id) });
            res.send(issue);
        });

        // Create issue
        app.post("/issues", async (req, res) => {
            const issue = req.body;

            // ⬇⬇ ALWAYS override reporter email with logged-in user's email
            const reporterEmail = issue.userEmail; // sent from frontend AuthContext ONLY
            if (!reporterEmail) return res.status(400).send({ message: "Reporter email missing" });

            issue.email = reporterEmail; // permanently set and override any form input

            // ===== existing logic unchanged =====
            const user = await usersCollection.findOne({ email: reporterEmail });

            const count = await issuesCollection.countDocuments({ email: reporterEmail });

            if (!user.premium && count >= 3) {
                return res.status(403).send({ message: "Free users can submit max 3 issues" });
            }

            issue.created_at = new Date();
            issue.status = "Pending";
            issue.priority = "Normal";
            issue.upvoteCount = 0;
            issue.upvotedBy = [];
            issue.assignedStaff = null;

            issue.timeline = [
                {
                    status: "Created",
                    message: "Issue submitted",
                    updatedBy: reporterEmail,
                    time: new Date(),
                },
            ];

            const result = await issuesCollection.insertOne(issue);
            res.send(result);
        });




        // Update Issue (citizen)
        app.patch("/issues/:id", async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedData }
            );

            const updated = await issuesCollection.findOne({ _id: new ObjectId(id) });
            res.send(updated);
        });

        app.get("/issues/count/:email", async (req, res) => {
            const email = req.params.email;

            const count = await issuesCollection.countDocuments({ userEmail: email });

            res.send({ count });
        });

        // DELETE issue on reject
        app.patch("/issues/reject/:id", async (req, res) => {
            const id = req.params.id;
            const result = await issuesCollection.deleteOne({ _id: new ObjectId(id) });

            if (result.deletedCount === 0) {
                return res.status(404).send({ message: "Issue not found" });
            }

            res.send({ success: true, message: "Issue deleted" });
        });

        app.get("/staff/issues/:email", async (req, res) => {
            const issues = await issuesCollection.find({
                "assignedStaff.email": req.params.email
            })
                .sort({ priority: -1 })
                .toArray();

            res.send(issues);
        });


        // Delete Issue
        app.delete("/issues/:id", async (req, res) => {
            await issuesCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send({ success: true });
        });

        // ==========================================================
        // ⭐ UPVOTE SYSTEM (User can upvote only once)
        // ==========================================================
        app.patch("/issues/upvote/:id", async (req, res) => {
            const id = req.params.id;
            const { userEmail } = req.body;

            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });

            if (!issue) return res.status(404).send({ message: "Issue not found" });

            if (issue.email === userEmail) {
                return res.status(400).send({ message: "Cannot upvote your own issue" });
            }

            if (issue.upvotedBy.includes(userEmail)) {
                return res.status(400).send({ message: "Already upvoted" });
            }

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

            const updatedIssue = await issuesCollection.findOne({ _id: new ObjectId(id) });
            res.send(updatedIssue);
        });

        // ==========================================================
        // ADMIN — ASSIGN STAFF
        // ==========================================================
        app.patch("/issues/assign/:id", async (req, res) => {
            const id = req.params.id;
            const { staffId } = req.body;

            // 1) Get the issue
            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
            if (!issue) return res.status(404).send({ message: "Issue not found" });

            // 2) Block reassignment (permanently disabled once assigned)
            if (issue.assignedStaff) {
                return res.status(400).send({ message: "Staff already assigned" });
            }

            // 3) Get the staff from users collection
            const staff = await usersCollection.findOne({ _id: new ObjectId(staffId) });
            if (!staff) return res.status(404).send({ message: "Staff not found" });

            // 4) Update issue
            await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: {
                        assignedStaff: {
                            id: staff._id,
                            name: staff.name,
                            email: staff.email,
                        },
                        assignedDate: new Date()
                        // ❗ REQUIREMENT: Status must NOT change (stay "Pending")
                    },
                    $push: {
                        timeline: {
                            status: "Assigned",
                            message: `Assigned to ${staff.name}`,
                            updatedBy: "Admin",
                            time: new Date(),
                        },
                    },
                }
            );

            res.send({ success: true });
        });


        // Reject Issue
        app.patch("/issues/reject/:id", async (req, res) => {
            const id = req.params.id;

            const result = await issuesCollection.deleteOne({
                _id: new ObjectId(id),
            });

            if (result.deletedCount === 0) {
                return res.status(404).send({ message: "Issue not found" });
            }

            res.send({ success: true, message: "Issue deleted" });
        });

        // Staff — Get issues resolved by this staff
        app.get("/staff/resolved/:email", async (req, res) => {
            const email = req.params.email;

            const resolvedIssues = await issuesCollection.find({
                status: "Resolved",
                updatedBy: email
            }).toArray();

            res.send(resolvedIssues);
        });



        app.delete("/staff/:email", async (req, res) => {
            const email = req.params.email;

            const result = await usersCollection.deleteOne({ email });

            res.send(result);
        });



        // ==========================================================
        // STAFF — Assigned Issues
        // ==========================================================
        app.get("/staff/issues/:email", async (req, res) => {
            const issues = await issuesCollection.find({
                "assignedStaff.email": req.params.email
            })
                .sort({ priority: -1 }) // boosted first
                .toArray();

            res.send(issues);
        });

        // Staff — Change Issue Status
        app.patch("/issues/status/:id", async (req, res) => {
            const id = req.params.id;
            const { status, updatedBy } = req.body;

            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });

            const flow = {
                Pending: ["In-Progress"],
                "In-Progress": ["Working"],
                Working: ["Resolved"],
                Resolved: ["Closed"]
            };

            if (!flow[issue.status]?.includes(status)) {
                return res.status(400).send({ message: "Invalid transition" });
            }

            await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: { status },
                    $push: {
                        timeline: {
                            status,
                            message: `Status changed to ${status}`,
                            updatedBy,
                            time: new Date()
                        }
                    }
                }
            );

            const updated = await issuesCollection.findOne({ _id: new ObjectId(id) });
            res.send(updated);
        });

        app.get("/issues/assigned/:email", async (req, res) => {
            const email = req.params.email;
            const issues = await issuesCollection
                .find({ "assignedStaff.email": email })
                .toArray();
            res.send(issues);
        });


        // ==========================================================
        // ADMIN DASHBOARD STATS
        // ==========================================================
        app.get("/admin/stats", async (req, res) => {
            const stats = {
                totalIssues: await issuesCollection.countDocuments(),
                pendingIssues: await issuesCollection.countDocuments({ status: "Pending" }),
                inProgress: await issuesCollection.countDocuments({ status: "In-Progress" }),
                working: await issuesCollection.countDocuments({ status: "Working" }),
                resolved: await issuesCollection.countDocuments({ status: "Resolved" }),
                closed: await issuesCollection.countDocuments({ status: "Closed" }),
                rejected: await issuesCollection.countDocuments({ status: "Rejected" }),
                totalUsers: await usersCollection.countDocuments(),
                totalPayments: 0 // you will add later
            };

            res.send(stats);
        });


        app.get("/admin/latest-issues", async (req, res) => {
            const result = await issuesCollection
                .find()
                .sort({ created_at: -1 })
                .limit(5)
                .toArray();

            res.send(result);
        });

        app.get("/admin/latest-payments", async (req, res) => {
            const result = await paymentsCollection
                .find()
                .sort({ paid_at: -1 })
                .limit(5)
                .toArray();

            res.send(result);
        });

        app.get("/admin/latest-users", async (req, res) => {
            const result = await usersCollection
                .find()
                .sort({ created_at: -1 })
                .limit(5)
                .toArray();

            res.send(result);
        });


        console.log("MongoDB Connected Successfully");
    } finally { }
}

run().catch(console.dir);

// Home Route
app.get("/", (req, res) => {
    res.send("CityFix backend running...");
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
