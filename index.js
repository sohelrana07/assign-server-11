const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
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

    // get user data
    app.get("/users", async (req, res) => {
      const cursor = userCollection.find();
      const result = await cursor.toArray();
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
    app.get("/assets", verifyJwtToken, async (req, res) => {
      const cursor = assetCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    // add asset data
    app.post("/assets", async (req, res) => {
      const asset = req.body;

      const email = req.body.addedBy;
      const user = await userCollection.findOne({ email });

      asset.companyName = user?.companyName || "Unknown";
      asset.createdAt = new Date();
      asset.updatedAt = new Date();

      const result = await assetCollection.insertOne(asset);
      res.send(result);
    });

    // add asset request
    app.post("/requests", verifyJwtToken, async (req, res) => {
      const assetRequest = req.body;
      const requesterEmail = req.decoded_email;

      const employee = await userCollection.findOne({
        email: requesterEmail,
      });

      console.log("after decoded", employee);

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
