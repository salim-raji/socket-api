const express = require("express");
const app = express();
const cors = require("cors");
const path = require("path");
const sharp = require("sharp");
const fs = require("fs");
const mongoose = require("mongoose");
const http = require("http").createServer(app);
const io = require("socket.io")(http, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST", "PATCH", "DELETE"], 
  },
});

const url = "mongodb+srv://salimraji:1234@mycluster.lbrtq.mongodb.net/myDatabase?retryWrites=true&w=majority&appName=myCluster";

mongoose
  .connect(url)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("Failed to connect to MongoDB:", err));

const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  imageUrl: String,
});

const User = mongoose.model("User", userSchema);


const corsOptions = {
  origin: "*", 
  methods: ["GET", "POST", "PATCH", "DELETE"], 
  allowedHeaders: ["Content-Type", "Authorization"], 
  credentials: true, 
};

app.use(cors(corsOptions)); 
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.json({ limit: "20mb" }));


app.get("/users", async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ error: "Could not fetch users" });
  }
});


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
  
      res.status(201).json(result);
    } catch (err) {
      res.status(500).json({ error: "Error processing request" });
    }
  });
  
  app.delete("/delete/:id", async (req, res) => {
    if (mongoose.Types.ObjectId.isValid(req.params.id)) {
      try {
        const result = await User.deleteOne({ _id: req.params.id });
  

        io.emit("user-deleted", req.params.id);
  
        res.status(200).json(result);
      } catch (err) {
        res.status(500).json({ error: "Could not delete user" });
      }
    } else {
      res.status(400).json({ error: "Invalid ID format" });
    }
  });
  
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
  
        const result = await User.updateOne({ _id: req.params.id }, { $set: updates });
  
        io.emit("user-updated", { _id: req.params.id, updates });
  
        res.status(200).json(result);
      } catch (err) {
        res.status(500).json({ error: "Error processing request" });
      }
    } else {
      res.status(400).json({ error: "Invalid ID format" });
    }
  });
  

http.listen(4000, () => {
  console.log("App is listening on port 4000");
});
