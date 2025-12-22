const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
require("dotenv").config();
var jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const port = process.env.PORT || 3000;

// middleware
app.use(cors());
app.use(express.json());

const verifyJwtToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = authorization.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.decoded_email = decoded.email;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@fast-cluster.usibdwl.mongodb.net/?appName=Fast-Cluster`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("AssetVerse server is running");
});

async function run() {
  try {
    await client.connect();
    const db = client.db("asset_verse_db");
    const userCollection = db.collection("users");
    const assetCollection = db.collection("assets");
    const requestCollection = db.collection("requests");
    const employeeAffiliationCollection = db.collection("employeeAffiliations");
    const packageCollection = db.collection("packages");
    const paymentCollection = db.collection("payments");

    // jwt related apis
    app.post("/getToken", async (req, res) => {
      const loggedUser = req.body;
      const token = jwt.sign(loggedUser, process.env.JWT_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token: token });
    });

    // Verify Hr
    const verifyHR = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email });

      if (user?.role !== "hr") {
        return res.status(403).send({ message: "forbidden access hr" });
      }
      next();
    };

    // Verify Employee
    const verifyEmployee = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email });

      if (user?.role !== "employee") {
        return res.status(403).send({ message: "forbidden access employee" });
      }
      next();
    };

    // get user data
    app.get("/users", verifyJwtToken, async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // get specific user data (profile)
    app.get("/users/me", verifyJwtToken, async (req, res) => {
      const email = req.decoded_email;

      const user = await userCollection.findOne(
        { email },
        {
          projection: {
            name: 1,
            email: 1,
            dateOfBirth: 1,
            role: 1,
            companyName: 1,
            packageLimit: 1,
            currentEmployees: 1,
            profileImage: 1,
            subscription: 1,
          },
        }
      );
      res.send(user);
    });

    // update specific user data (profile)
    app.patch("/users/me", verifyJwtToken, async (req, res) => {
      const email = req.decoded_email;
      const updatedData = req.body;
      updatedData.updatedAt = new Date();

      const result = await userCollection.updateOne(
        { email },
        { $set: updatedData }
      );

      res.send(result);
    });

    // get role
    app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };

      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "employee" });
    });

    // add user data
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.createdAt = new Date();
      user.updatedAt = new Date();

      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);

      if (existingUser) {
        return res.status(409).send({ message: "User already exists" });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // get asset data (Employee)
    app.get("/assets", verifyJwtToken, verifyEmployee, async (req, res) => {
      const cursor = assetCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // get asset data (HR)
    app.get("/hr/assets", verifyJwtToken, verifyHR, async (req, res) => {
      const hrEmail = req.decoded_email;
      const search = req.query.search || "";
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const skip = (page - 1) * limit;

      const query = {
        hrEmail,
        productName: { $regex: search, $options: "i" },
      };

      const cursor = assetCollection
        .find(query)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
      const assets = await cursor.toArray();
      res.send(assets);
    });

    // add asset data (Only admin)
    app.post("/assets", verifyJwtToken, verifyHR, async (req, res) => {
      const asset = req.body;

      const email = req.body.hrEmail;
      const user = await userCollection.findOne({ email });

      asset.productQuantity = Number(asset.productQuantity);
      asset.availableQuantity = Number(asset.availableQuantity);
      asset.companyName = user?.companyName || "Unknown";
      asset.companyLogo = user?.companyLogo || "";
      asset.createdAt = new Date();
      asset.updatedAt = new Date();

      const result = await assetCollection.insertOne(asset);
      res.send(result);
    });

    // update asset data (HR)
    app.patch("/assets/:id", verifyJwtToken, verifyHR, async (req, res) => {
      const id = req.params.id;
      const body = req.body;

      // find old data
      const asset = await assetCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!asset) {
        return res.status(404).send({ message: "Asset not found" });
      }

      const updatedAsset = {};

      if (body.productName) {
        updatedAsset.productName = body.productName;
      }

      if (body.productImage) {
        updatedAsset.productImage = body.productImage;
      }

      if (body.productType) {
        updatedAsset.productType = body.productType;
      }

      //  Quantity related
      if (body.productQuantity !== undefined && body.productQuantity !== "") {
        const newQuantity = Number(body.productQuantity);
        const oldQuantity = asset.productQuantity;
        const oldAvailable = asset.availableQuantity;

        const difference = newQuantity - oldQuantity;

        updatedAsset.productQuantity = newQuantity;

        if (difference > 0) {
          updatedAsset.availableQuantity = oldAvailable + difference;
        } else {
          updatedAsset.availableQuantity = Math.min(oldAvailable, newQuantity);
        }
      }

      updatedAsset.updatedAt = new Date();

      const result = await assetCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedAsset }
      );

      res.send(result);
    });

    // delete asset (HR)
    app.delete("/assets/:id", verifyJwtToken, verifyHR, async (req, res) => {
      const id = req.params.id;

      const result = await assetCollection.deleteOne({
        _id: new ObjectId(id),
      });

      res.send(result);
    });

    // get asset request (Only admin)
    app.get("/requests", verifyJwtToken, verifyHR, async (req, res) => {
      const hrEmail = req.decoded_email;

      const cursor = requestCollection.find({ hrEmail: hrEmail });
      const result = await cursor.toArray();
      res.send(result);
    });

    // add asset request
    app.post("/requests", verifyJwtToken, verifyEmployee, async (req, res) => {
      const assetRequest = req.body;
      const requesterEmail = req.decoded_email;

      const employee = await userCollection.findOne({
        email: requesterEmail,
      });

      if (!employee) {
        return res.send({ message: "Employee not found" });
      }

      assetRequest.requesterName = employee.name;
      assetRequest.requesterEmail = requesterEmail;
      assetRequest.requestDate = new Date();
      assetRequest.approvalDate = null;
      assetRequest.requestStatus = "pending";
      assetRequest.processedBy = null;

      const result = await requestCollection.insertOne(assetRequest);
      res.send(result);
    });

    // Approve request
    app.patch(
      "/requests/approve/:id",
      verifyJwtToken,
      verifyHR,
      async (req, res) => {
        const requestId = req.params.id;

        const query = { _id: new ObjectId(requestId) };
        const request = await requestCollection.findOne(query);

        const filter = { email: request.requesterEmail };
        const employee = await userCollection.findOne(filter);

        const asset = await assetCollection.findOne({
          _id: new ObjectId(request.assetId),
        });

        // Request collection
        await requestCollection.updateOne(query, {
          $set: {
            requestStatus: "approved",
            approvalDate: new Date(),
            processedBy: req.decoded_email,
          },
        });

        // Assets collection
        await assetCollection.updateOne(
          { _id: new ObjectId(request.assetId) },
          { $inc: { availableQuantity: -1 } }
        );

        // Users collection
        const newAsset = {
          assetId: asset._id,
          assetName: asset.productName,
          assetImage: asset.productImage,
          assetType: asset.productType,
          companyName: asset.companyName,
          hrEmail: asset.hrEmail,
          requestDate: request.requestDate,
          approvalDate: new Date(),
          assignedAt: new Date(),
          status: "assigned",
        };

        if (employee.assets) {
          await userCollection.updateOne(
            { email: employee.email },
            { $push: { assets: newAsset } }
          );
        } else {
          await userCollection.updateOne(
            { email: employee.email },
            { $set: { assets: [newAsset] } }
          );
        }

        // employeeAffiliations
        const existingAffiliation = await employeeAffiliationCollection.findOne(
          {
            employeeEmail: employee.email,
            companyName: asset.companyName,
          }
        );

        if (!existingAffiliation) {
          await employeeAffiliationCollection.insertOne({
            employeeEmail: employee.email,
            employeeName: employee.name,
            hrEmail: asset.hrEmail,
            companyName: asset.companyName,
            companyLogo: asset.companyLogo,
            affiliationDate: new Date(),
            status: "active",
          });

          await userCollection.updateOne(
            { email: asset.hrEmail },
            { $inc: { currentEmployees: 1 } }
          );
        }

        res.send({
          message: "Request approved successfully",
          modifiedCount: 1,
        });
      }
    );

    // Reject request
    app.patch(
      "/requests/reject/:id",
      verifyJwtToken,
      verifyHR,
      async (req, res) => {
        const requestId = req.params.id;

        const query = { _id: new ObjectId(requestId) };
        const result = await requestCollection.updateOne(query, {
          $set: {
            requestStatus: "rejected",
            approvalDate: new Date(),
            processedBy: req.decoded_email,
          },
        });

        res.send(result);
      }
    );

    // get employee own asset
    app.get("/my-assets", verifyJwtToken, verifyEmployee, async (req, res) => {
      const email = req.decoded_email;
      const employee = await userCollection.findOne(
        { email },
        {
          projection: { assets: 1, _id: 0 },
        }
      );
      res.send(employee?.assets || []);
    });

    // My Employee List (HR)
    app.get("/my-employees", verifyJwtToken, verifyHR, async (req, res) => {
      const hrEmail = req.decoded_email;

      const affiliations = await employeeAffiliationCollection
        .find({
          hrEmail: hrEmail,
          status: "active",
        })
        .toArray();

      // employee details add
      const employees = [];

      for (const item of affiliations) {
        const employee = await userCollection.findOne(
          { email: item.employeeEmail },
          {
            projection: {
              name: 1,
              email: 1,
              profileImage: 1,
              assets: 1,
            },
          }
        );

        employees.push({
          employeeName: item.employeeName,
          employeeEmail: item.employeeEmail,
          profileImage: employee?.profileImage,
          joinDate: item.affiliationDate,
          assetsCount: employee?.assets?.length || 0,
          companyName: item.companyName,
          companyLogo: item.companyLogo,
        });
      }

      res.send(employees);
    });

    // Remove employee from Employee List (HR)
    app.patch(
      "/my-employees/remove/:email",
      verifyJwtToken,
      verifyHR,
      async (req, res) => {
        const employeeEmail = req.params.email;
        const hrEmail = req.decoded_email;

        /* find affiliation */
        const affiliation = await employeeAffiliationCollection.findOne({
          employeeEmail: employeeEmail,
          hrEmail: hrEmail,
          status: "active",
        });

        if (!affiliation) {
          return res.send({ message: "Employee not found in your team" });
        }

        /* update affiliation */
        const result = await employeeAffiliationCollection.updateOne(
          { _id: affiliation._id },
          {
            $set: {
              status: "inactive",
              removedAt: new Date(),
            },
          }
        );

        /* decrease HR employee count */
        await userCollection.updateOne(
          { email: hrEmail },
          { $inc: { currentEmployees: -1 } }
        );

        res.send({
          modifiedCount: result.modifiedCount,
          message: "Employee removed successfully",
        });
      }
    );

    // My Team - get companies (Employee)
    app.get(
      "/my-team/companies",
      verifyJwtToken,
      verifyEmployee,
      async (req, res) => {
        const email = req.decoded_email;

        const affiliations = await employeeAffiliationCollection
          .find({
            employeeEmail: email,
            status: "active",
          })
          .toArray();

        const companies = affiliations.map((item) => ({
          companyName: item.companyName,
          companyLogo: item.companyLogo,
        }));

        res.send(companies);
      }
    );

    // My Team - get data (Employee)
    app.get("/my-team", verifyJwtToken, verifyEmployee, async (req, res) => {
      const companyName = req.query.company;

      const affiliations = await employeeAffiliationCollection
        .find({
          companyName: companyName,
          status: "active",
        })
        .toArray();

      /* get user email */
      const emails = affiliations.map((a) => a.employeeEmail);

      const users = await userCollection
        .find(
          { email: { $in: emails } },
          {
            projection: {
              name: 1,
              email: 1,
              dateOfBirth: 1,
              profileImage: 1,
              role: 1,
            },
          }
        )
        .toArray();

      /* team list */
      const team = users.map((user) => ({
        name: user?.name,
        email: user?.email,
        photo: user?.profileImage,
        position: user?.role,
        dateOfBirth: user?.dateOfBirth,
      }));

      /* upcoming birthdays */
      const currentMonth = new Date().getMonth() + 1;

      const upcomingBirthdays = team.filter((member) => {
        if (!member.dateOfBirth) return false;
        const birthMonth = new Date(member.dateOfBirth).getMonth() + 1;
        return birthMonth === currentMonth;
      });

      res.send({
        team,
        upcomingBirthdays,
      });
    });

    // get all packages (public)
    app.get("/packages", async (req, res) => {
      const cursor = packageCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // Payment related apis (HR)
    app.post(
      "/create-payment-session",
      verifyJwtToken,
      verifyHR,
      async (req, res) => {
        const { packageId, packageName, amount } = req.body;
        const amountNumber = parseInt(amount) * 100;
        const userEmail = req.decoded_email;

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amountNumber,
                product_data: { name: packageName },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          metadata: {
            packageId,
            packageName,
            userEmail,
          },
          customer_email: userEmail,
          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`,
        });

        res.send({ url: session.url });
      }
    );

    // Payment success (HR)
    app.patch(
      "/payment-success",
      verifyJwtToken,
      verifyHR,
      async (req, res) => {
        const sessionId = req.query.session_id;
        console.log("text 1", sessionId);

        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const transactionId = session.payment_intent;
        const query = { transactionId: transactionId };
        const existingPayment = await paymentCollection.findOne(query);

        console.log("text 2", existingPayment);

        if (existingPayment) {
          return res.send({ message: "Payment already exists", transactionId });
        }

        const { packageId, packageName, userEmail } = session.metadata;

        if (session.payment_status === "paid") {
          const packageInfo = await packageCollection.findOne({
            _id: new ObjectId(packageId),
          });

          const payment = {
            packageId,
            userEmail,
            packageName,
            amount: session.amount_total / 100,
            currency: session.currency,
            transactionId: session.payment_intent,
            paymentStatus: "paid",
            paidAt: new Date(),
          };

          await paymentCollection.insertOne(payment);

          // update user info
          await userCollection.updateOne(
            { email: userEmail },
            {
              $set: {
                subscription: packageName,
                packageLimit: packageInfo.employeeLimit,
              },
            }
          );

          return res.send({ success: true, payment });
        }

        return res.send({ success: false, message: "Payment not completed" });
      }
    );

    // payment history (HR)
    app.get("/payments/history", verifyJwtToken, verifyHR, async (req, res) => {
      const userEmail = req.decoded_email;

      const payments = await paymentCollection
        .find({ userEmail })
        .sort({ paidAt: -1 })
        .toArray();

      res.send(payments);
    });

    // Analytics (HR)
    app.get(
      "/dashboard/analytics",
      verifyJwtToken,
      verifyHR,
      async (req, res) => {
        const hrEmail = req.decoded_email;

        // Returnable vs Non-returnable
        const assets = await assetCollection.find({ hrEmail }).toArray();
        const returnableCount = assets.filter(
          (a) => a.productType === "Returnable"
        ).length;
        const nonReturnableCount = assets.filter(
          (a) => a.productType === "Non-returnable"
        ).length;

        const pieData = [
          { name: "Returnable", value: returnableCount },
          { name: "Non-returnable", value: nonReturnableCount },
        ];

        // most requested assets
        const pipeline = [
          { $match: { hrEmail } },
          { $group: { _id: "$assetId", requestCount: { $sum: 1 } } },
          { $sort: { requestCount: -1 } },
          { $limit: 5 },
        ];

        const topRequests = await requestCollection
          .aggregate(pipeline)
          .toArray();

        //  bar chart data
        const barData = [];

        for (const request of topRequests) {
          const asset = await assetCollection.findOne({
            _id: new ObjectId(request._id),
          });

          barData.push({
            name: asset?.productName || "Unknown",
            requests: request.requestCount,
          });
        }

        res.send({ pieData, barData });
      }
    );

    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`AssetVerse server is running on port ${port}`);
});
