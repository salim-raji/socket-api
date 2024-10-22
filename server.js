const express = require("express");
const app = express();
const cors = require("cors");
const path = require("path");
const sharp = require("sharp");
const fs = require("fs");
const mongoose = require("mongoose");
const http = require("http").createServer(app);
const Redis = require("redis");
const io = require("socket.io")(http, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST", "PATCH", "DELETE"], 
  },
});

//Redis client
const redisClient = Redis.createClient({
  url: 'redis://localhost:6379' 
});
redisClient.connect().then(() => {
  console.log('Connected to Redis');
}).catch((err) => {
  console.log(err.message);
});

// MongoDB connection string
const url = "mongodb+srv://salimraji:1234@mycluster.lbrtq.mongodb.net/myDatabase?retryWrites=true&w=majority&appName=myCluster";
mongoose
  .connect(url)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Failed to connect to MongoDB:", err));

// Mongoose
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  imageUrl: String,
});
const User = mongoose.model("User", userSchema);

// CORS options
const corsOptions = {
  origin: "*", 
  methods: ["GET", "POST", "PATCH", "DELETE"], 
  allowedHeaders: ["Content-Type", "Authorization"], 
  credentials: true, 
};

app.use(cors(corsOptions)); 
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Cache function
async function checkCache(req, res, next) {
  const key = req.path;
  try {
      const data = await redisClient.get(key);
      if (data) {
          return res.json(JSON.parse(data));
      } else {
          next(); 
      }
  } catch (error) {
      res.status(500).json({ error: 'An error occurred while checking the cache.' });
  }
}

app.get("/users", checkCache, async (req, res) => {
  try {
      const users = await User.find();
      await redisClient.SETEX(req.path, 3600, JSON.stringify(users)); 
      res.json(users); 
  } catch (error) {
      res.status(500).json({ error: 'An error occurred while fetching users.' });
  }
});

// POST endpoint
app.post("/post", async (req, res) => {
  const newUser = req.body;

  try {
      if (newUser.imageUrl) {
          const match = newUser.imageUrl.match(/^data:image\/(png|jpeg|jpg|gif|bmp);base64,(.+)$/);
          if (!match) {
              return res.status(400).json({ error: "Invalid image format" });
          }

          const base64Data = match[2];
          const fileName = `${Date.now()}.png`;
          const filePath = path.join(__dirname, "uploads", fileName);

          await sharp(Buffer.from(base64Data, "base64"))
              .resize(400, 400)
              .toFile(filePath);

          if (!fs.existsSync(filePath)) {
              return res.status(500).json({ error: "Image not saved" });
          }

          const publicUrl = `${req.protocol}://${req.get("host")}/uploads/${fileName}`;
          newUser.imageUrl = publicUrl;
      }

      const user = new User(newUser);
      const result = await user.save();
      io.emit("user-added", result);


      await redisClient.del('/users'); 
      const users = await User.find();
      await redisClient.SETEX('/users', 3600, JSON.stringify(users)); 

      res.status(201).json(result);
  } catch (err) {
      res.status(500).json({ error: "Error processing request" });
  }

  await sendPushNotification({
      action: 'User Added',
      message: `User has been added.`,
  });
});

// DELETE endpoint
app.delete("/delete/:id", async (req, res) => {
  if (mongoose.Types.ObjectId.isValid(req.params.id)) {
      try {
          const result = await User.deleteOne({ _id: req.params.id });
          io.emit("user-deleted", req.params.id);

          await redisClient.del('/users'); 
          const users = await User.find();
          await redisClient.SETEX('/users', 3600, JSON.stringify(users)); 

          res.status(200).json(result);
      } catch (err) {
          res.status(500).json({ error: "Could not delete user" });
      }
  } else {
      res.status(400).json({ error: "Invalid ID format" });
  }

  await sendPushNotification({
      action: 'User Deleted',
      message: `User has been deleted.`,
  });
});

// PATCH endpoint
app.patch("/update/:id", async (req, res) => {
  const updates = req.body;

  if (mongoose.Types.ObjectId.isValid(req.params.id)) {
      try {
          if (updates.imageUrl) {
              const match = updates.imageUrl.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/);
              if (!match) {
                  return res.status(400).json({ error: "Invalid image format" });
              }

              const base64Data = match[2];
              const fileName = `${Date.now()}.png`;
              const filePath = path.join(__dirname, "uploads", fileName);

              await sharp(Buffer.from(base64Data, "base64"))
                  .resize(400, 400)
                  .toFile(filePath);

              if (!fs.existsSync(filePath)) {
                  return res.status(500).json({ error: "Image not saved" });
              }

              const publicUrl = `${req.protocol}://${req.get("host")}/uploads/${fileName}`;
              updates.imageUrl = publicUrl;
          }

          await User.updateOne({ _id: req.params.id }, { $set: updates });
          io.emit("user-updated", { _id: req.params.id, updates });


          await redisClient.del('/users'); 
          const users = await User.find();
          await redisClient.SETEX('/users', 3600, JSON.stringify(users)); 

          res.status(200).json({ message: "User updated successfully." });
      } catch (err) {
          res.status(500).json({ error: "Error processing request" });
      }
  } else {
      res.status(400).json({ error: "Invalid ID format" });
  }

  await sendPushNotification({
      action: 'User Updated',
      message: `User has been updated.`,
  });
});

  
// WEB PUSH setup
const webPush = require('web-push');

const vapidKeys = {
  publicKey: 'BMxcrvZIF9H2bz7koJhag9g96Thx8drIJ7EoWYwORS97bRreZ9jimch8HaZMeLqR4E-IiWiSJAb72-V6Exuaj1M',
  privateKey: 'SpDkDU33-GG3y9Aw0nLth89HB35qIpTmiHuz2dbu9M4',
};

webPush.setVapidDetails(
  'mailto:salimraji@icloud.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

let subscriptions = [];

app.post('/subscribe', (req, res) => {
  const subscription = req.body;
  subscriptions.push(subscription);
  res.status(201).json({});
});

async function sendPushNotification(data) {
  const payload = JSON.stringify({
    title: data.action,
    body: data.message,
  });

  for (const subscription of subscriptions) {
    try {
      await webPush.sendNotification(subscription, payload);
    } catch (error) {
      console.error('Error sending notification:', error);
    }
  }
}

http.listen(4000, () => {
  console.log("App is listening on port 4000");
});
