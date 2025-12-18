const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
require("dotenv").config();
var jwt = require("jsonwebtoken");
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
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // Verify Employee
    const verifyEmployee = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await userCollection.findOne({ email });

      if (user?.role !== "employee") {
        return res.status(403).send({ message: "forbidden access" });
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

    // get asset data
    app.get("/assets", verifyJwtToken, verifyEmployee, async (req, res) => {
      const cursor = assetCollection.find();
      const result = await cursor.toArray();
      res.send(result);
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

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`AssetVerse server is running on port ${port}`);
});
