const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

console.log("Stripe key loaded:", process.env.STRIPE_SECRET ? "YES" : "NO");

const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());


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
        //await client.connect();

        const db = client.db("city_fix_db");

        const usersCollection = db.collection("users");
        const issuesCollection = db.collection("issues");
        const paymentsCollection = db.collection("payments");

        // ==========================================================
        // USERS
        // ==========================================================


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


        app.get('/users', async (req, res) => {
            const role = req.query.role;

            const query = role ? { role } : {};

            const result = await usersCollection.find(query).toArray();
            res.send(result);
        });


        app.get('/users/:email', async (req, res) => {
            const user = await usersCollection.findOne({ email: req.params.email });
            if (!user) return res.status(404).send({ message: "User not found" });
            res.send(user);
        });


        app.patch('/users/block/:email', async (req, res) => {
            const { blocked } = req.body;
            const result = await usersCollection.updateOne(
                { email: req.params.email },
                { $set: { blocked } }
            );
            res.send({ success: true });
        });


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






        app.get("/issues", async (req, res) => {
            const { email } = req.query;
            const query = email ? { email } : {};
            const issues = await issuesCollection.find(query).toArray();
            res.send(issues);
        });


        app.get("/issues/:id", async (req, res) => {
            const issue = await issuesCollection.findOne({ _id: new ObjectId(req.params.id) });
            res.send(issue);
        });


        app.post("/issues", async (req, res) => {
            const issue = req.body;


            const reporterEmail = issue.userEmail;
            if (!reporterEmail) return res.status(400).send({ message: "Reporter email missing" });

            issue.email = reporterEmail;
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



        app.get("/issues/resolved/latest", async (req, res) => {
            try {
                const issues = await issuesCollection
                    .find({ status: "Closed" })
                    .sort({ updatedAt: -1 })
                    .limit(6)
                    .toArray();

                res.send(issues);
            } catch (error) {
                res.status(500).send({ message: "Failed to fetch resolved issues" });
            }
        });



        app.delete("/issues/:id", async (req, res) => {
            await issuesCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send({ success: true });
        });


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


        app.patch("/issues/assign/:id", async (req, res) => {
            const id = req.params.id;
            const { staffId } = req.body;


            const issue = await issuesCollection.findOne({ _id: new ObjectId(id) });
            if (!issue) return res.status(404).send({ message: "Issue not found" });


            if (issue.assignedStaff) {
                return res.status(400).send({ message: "Staff already assigned" });
            }


            const staff = await usersCollection.findOne({ _id: new ObjectId(staffId) });
            if (!staff) return res.status(404).send({ message: "Staff not found" });


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




        app.get("/staff/issues/:email", async (req, res) => {
            const issues = await issuesCollection.find({
                "assignedStaff.email": req.params.email
            })
                .sort({ priority: -1 })
                .toArray();

            res.send(issues);
        });


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



        app.get("/admin/stats", async (req, res) => {
            try {

                const totalPaymentsAgg = await paymentsCollection
                    .aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
                    .toArray();
                const totalPayments = totalPaymentsAgg[0]?.total || 0;


                const boostedIssues = await issuesCollection.countDocuments({ priority: "High" });


                const closedCount = await issuesCollection.countDocuments({ status: "Closed" });


                const pendingCount = await issuesCollection.countDocuments({ status: "Pending" });


                const totalIssues = await issuesCollection.countDocuments();


                const totalUsers = await usersCollection.countDocuments();

                const stats = {
                    totalIssues,
                    pendingIssues: pendingCount,
                    closed: closedCount,
                    boostedIssues,
                    totalUsers,
                    totalPayments,
                };

                res.send(stats);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to fetch admin stats" });
            }
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




        app.patch("/issues/boost/:id", async (req, res) => {
            const id = req.params.id;
            const { userEmail } = req.body;

            const issue = await issuesCollection.findOne({
                _id: new ObjectId(id)
            });

            if (!issue) {
                return res.status(404).send({ message: "Issue not found" });
            }

            if (issue.priority === "High") {
                return res.status(400).send({ message: "Issue already boosted" });
            }


            const paymentSuccess = true;
            if (!paymentSuccess) {
                return res.status(400).send({ message: "Payment failed" });
            }

            await issuesCollection.updateOne(
                { _id: new ObjectId(id) },
                {
                    $set: { priority: "High" },
                    $push: {
                        timeline: {
                            status: "Boosted",
                            message: "Issue boosted with 100 BDT",
                            updatedBy: userEmail,
                            time: new Date()
                        }
                    }
                }
            );

            res.send({ success: true });
        });



        app.patch("/users/subscribe/:email", async (req, res) => {
            const email = req.params.email;

            const user = await usersCollection.findOne({ email });

            if (!user) {
                return res.status(404).send({ message: "User not found" });
            }

            if (user.blocked) {
                return res.status(403).send({ message: "User is blocked" });
            }

            if (user.subscription?.status === "active") {
                return res.status(400).send({ message: "Already subscribed" });
            }


            const paymentSuccess = true;
            if (!paymentSuccess) {
                return res.status(400).send({ message: "Payment failed" });
            }

            await usersCollection.updateOne(
                { email },
                {
                    $set: {
                        subscription: {
                            status: "active",
                            plan: "Premium",
                            subscribedAt: new Date()
                        },
                        premium: true
                    }
                }
            );

            const updatedUser = await usersCollection.findOne({ email });
            res.send(updatedUser);
        });





        app.get("/payments", async (req, res) => {
            try {
                const { email } = req.query;


                const query = email ? { email } : {};

                const payments = await paymentsCollection
                    .find(query)
                    .toArray();

                res.send(payments);
            } catch (error) {
                res.status(500).send({ message: "Failed to fetch payments" });
            }
        });



        app.post("/create-checkout-session", async (req, res) => {
            const { email, type, issueId } = req.body;

            const session = await stripe.checkout.sessions.create({
                line_items: [
                    {
                        price_data: {
                            currency: "bdt",
                            unit_amount: type === "subscribe" ? 1000 * 100 : 100 * 100,
                            product_data: {
                                name: type === "subscribe"
                                    ? "Premium Subscription"
                                    : "Issue Boost",
                            },
                        },
                        quantity: 1,
                    },
                ],

                mode: "payment",
                customer_email: email,


                metadata: {
                    email,
                    type,
                    issueId: issueId || "",
                },

                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
            });

            res.send({ url: session.url });
        });



        app.post("/payments/verify", async (req, res) => {
            const { sessionId } = req.body;

            const session = await stripe.checkout.sessions.retrieve(sessionId);


            const exists = await paymentsCollection.findOne({
                stripeSessionId: session.id,
            });

            if (exists) {
                return res.send({ message: "Payment already recorded" });
            }

            await paymentsCollection.insertOne({
                email: session.metadata.email,
                type: session.metadata.type,
                issueId: session.metadata.issueId || null,
                amount: session.amount_total / 100,
                currency: session.currency,
                stripeSessionId: session.id,
                paymentStatus: session.payment_status,
                createdAt: new Date(),
            });


            if (session.metadata.type === "subscribe") {
                await usersCollection.updateOne(
                    { email: session.metadata.email },
                    {
                        $set: {
                            premium: true,
                            subscription: {
                                status: "active",
                                subscribedAt: new Date(),
                            },
                        },
                    }
                );
            }

            if (session.metadata.type === "boost") {
                await issuesCollection.updateOne(
                    { _id: new ObjectId(session.metadata.issueId) },
                    {
                        $set: { priority: "High" },
                        $push: {
                            timeline: {
                                status: "Boosted",
                                message: "Issue boosted via payment",
                                updatedBy: session.metadata.email,
                                time: new Date(),
                            },
                        },
                    }
                );
            }


            res.send({ success: true });
        });







        console.log("MongoDB Connected Successfully");
    } finally { }
}

run().catch(console.dir);


app.get("/", (req, res) => {
    res.send("CityFix backend running...");
});

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});