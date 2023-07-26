const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User.model");
const Text = require("../models/Text.model");
const Record = require("../models/Record.model");
const { Configuration, OpenAIApi, TranscriptionsApi } = require("openai");
const FormData = require("form-data");
const path = require("path");
// Middlewares
const { isAuthenticated } = require("../middlewares/jwt.auth");
const cloudinaryAudioUploader = require("../middlewares/cloudinary.config.js");
const cloudinaryImageUploader = require("../middlewares/cloudinary.imageConfig.js");
const multerAudioUploader = require("../middlewares/multer.config");

const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);

router.post(
  "/signup",
  cloudinaryImageUploader.single("userImage"),
  async (req, res) => {
    const saltRounds = 13;
    const salt = bcrypt.genSaltSync(saltRounds);
    const hash = bcrypt.hashSync(req.body.password, salt);
    const newUser = await User.create({
      email: req.body.email,
      ...(req.file ? { userImage: req.file.path } : {}),
      password: hash,
    });
    // console.log("here is our new user in the DB", newUser);
    res.status(201).json(newUser);
  }
);

router.post("/login", async (req, res) => {
  try {
    const foundUser = await User.findOne({ email: req.body.email });
    if (foundUser) {
      const passwordMatch = bcrypt.compareSync(
        req.body.password,
        foundUser.password
      );
      if (passwordMatch) {
        //take the info you want from the user without sensetive data
        const { _id, email } = foundUser;
        const payload = { _id, email };
        // Create and sign the token
        const authToken = jwt.sign(payload, process.env.TOKEN_SECRET, {
          algorithm: "HS256",
          expiresIn: "6h",
        });
        console.log("here is my new token", authToken);
        res.status(200).json({ authToken });
      }
    } else {
      res.status(400).json({ message: "email or password do not match" });
    }
  } catch (err) {
    console.log(err);
  }
});

router.get("/verify", isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.payload._id);
    res.status(200).json({ user: user.toObject(), userImage: user.userImage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred" });
  }
});

router.get(
  "/transcribe",
  isAuthenticated,
  cloudinaryAudioUploader.single("recordPath"),
  async (req, res, next) => {
    try {
      // TO TO / TO DELETE: transcribing a local file, saved in the project directory and then sending it to transcription

      // This is defining the path of the local file:

      const filePath = path.join(__dirname, "../audio copy.mp3");
      const model = "whisper-1";
      const formData = new FormData();
      formData.append("model", model);
      formData.append("file", fs.createReadStream(filePath));

      const response = axios
        .post("https://api.openai.com/v1/audio/transcriptions", formData, {
          headers: {
            ...formData.getHeaders(),
            authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": `multipart/form-data; boundary=${formData._boundary}`,
          },
        })
        .then((response) => {
          console.log(response.data.text);
          const text = response.data.text;
          res.json({ text });
        });
    } catch (err) {
      console.error("error with openai axios call", err);
      res.status(500).json({ error: "An error occurred" });
    }
  }
);

router.post("/profile", isAuthenticated, async (req, res, next) => {
  try {
    const user = await User.findByIdAndDelete(req.payload._id);
    user.delete();
    res.status(201).json(user);
    res.status(200).json({ message: "User account deleted successfully" });
    console.log("hi from profile POST");
  } catch (err) {
    console.log("Error deleting user account", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

router.get("/editUser/:userId", isAuthenticated, async (req, res, next) => {
  const { userId } = req.params;
  const user = await User.findById(userId);
  console.log(user);
  res.status(200).json(user);
});

router.put(
  "/editUser/:userId",
  isAuthenticated,
  cloudinaryImageUploader.single("userImage"),
  async (req, res, next) => {
    try {
      const saltRounds = 13;
      const salt = bcrypt.genSaltSync(saltRounds);
      const hash = bcrypt.hashSync(req.body.password, salt);
      const { userId } = req.params;
      const userToEdit = await User.findByIdAndUpdate(userId, 
        {
        email: req.body.email,
        ...(req.file ? { userImage: req.file.path } : {}),
        password: hash,
      });
      res.status(200).json(userToEdit);
    } catch (err) {
      console.log("Error editing user account", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

// TO DO / TO DELETE
router.get("/transcribe", isAuthenticated, async (req, res, next) => {
  console.log("Hello from TRANSCRIBE");
});

// TO DO / TO DELETE
router.get("/addRecord", isAuthenticated, async (req, res, next) => {
  console.log("Hello from ADDRECORD");
});

// DELETE USER .GET AND .POST ROUTES
router.get("/deleteUser/:userId", isAuthenticated, async (req, res, next) => {
  try {
    const { userId } = req.params;
    console.log(userId, "id from deleteUser ROUTE");
    const user = await User.findById(userId);
    res.status(200).json(user);
  } catch (err) {
    console.log("Error editing user account", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

router.post("/deleteUser/:userId", isAuthenticated, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const userToDelete = await User.findByIdAndDelete(userId);
    res.status(200).json(userToDelete);
  } catch (err) {
    console.log("Error editing user account", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

router.post(
  "/addRecord",
  isAuthenticated,
  cloudinaryAudioUploader.single("recordPath"),
  async (req, res, next) => {
    // Upload a file from user's drive > upload it to cloudinary > then save it to local file in project > send it to be transcribed
    try {
      // Take record from the form and upload it to mongoose
      const record = new Record({
        title: req.body.title,
        recordPath: req.file.path,
      });
      await record.save();

      const recordId = record._id;
      // Associate the record with the user
      await User.findByIdAndUpdate(
        req.payload._id,
        { $push: { record: recordId } },
        { new: true }
      );

      // Search for the record URL
      const searchedRecord = await Record.findById(recordId);
      const audioUrl = searchedRecord.recordPath;

      // save audio to a local file
      const localFilePath = "./temporary.mp3";
      saveAudioToLocal(audioUrl, localFilePath)
        .then(() => {
          console.log("Audio file saved successfully!");
          sendToApi();
        })
        .catch((error) => {
          console.error("Error saving audio file:", error);
        });

      // define function saveAudioToLocal which creates a stream out of a URL and saves it to a local file
      async function saveAudioToLocal(url, filePath) {
        const writer = fs.createWriteStream(filePath);
        const response = await axios({
          url,
          method: "GET",
          responseType: "stream",
        });
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
        });
      }

      // define function sendToApi which sends the file to be transcribed
      async function sendToApi() {
        const filePath = path.join(__dirname, "../temporary.mp3");
        const model = "whisper-1";

        const formData = new FormData();
        formData.append("model", model);
        formData.append("file", fs.createReadStream(filePath));

        axios
          .post("https://api.openai.com/v1/audio/transcriptions", formData, {
            headers: {
              ...formData.getHeaders(),
              authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": `multipart/form-data; boundary=${formData._boundary}`,
            },
          })
          .then((response) => {
            const text = response.data.text;
            console.log(text);
            res.json({ text });
            return Record.findByIdAndUpdate(
              searchedRecord,
              { transcript: text },
              { new: true }
            );
          });
      }
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "An error occurred" });
    }
  }
);

router.get("/write", isAuthenticated, async (req, res, next) => {
  try {
    // Get the last record transcript
    const user = await User.findById(req.payload._id);
    // console.log("user", user);
    const lastRecordId = user.record[user.record.length - 1]._id;
    const foundRecord = await Record.findById(lastRecordId);
    const prompt = foundRecord.transcript;

    // Generate OpenAI chat completion
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "user",
          content: `Hi, can you please write a short feedback text with this context: ${prompt}`,
        },
      ],
    });

    const text = completion.data.choices[0].message.content;

    // Create and save writtenText before sending the response
    const writtenText = await Text.create({ writtenText: text });
    // associate with user 
    // await User.findByIdAndUpdate(
    //   req.payload._id,
    //   { $push: { writtenText: writtenText._id } },
    //   { new: true }
    // );

      //  associate with record 
      console.log("lastRecordId", lastRecordId);
      console.log("writtenText", writtenText);
      console.log("text",text);
      await Record.findByIdAndUpdate(
        lastRecordId,
      // { writtenText: text },
      {
        writtenText: {
          _id: writtenText._id,
          text: text,
        },
      },
      { new: true }
    );

    res.json({ text });
  } catch (err) {
    console.error("Error with OpenAI Chat Completion", err);
    res.status(500).json({ error: "An error occurred" });
  }
});

// Record route: this route saves a file recorded by user to the project repo
router.post(
  "/record",
  isAuthenticated,
  multerAudioUploader.single("audio"),
  async (req, res, next) => {
    try {
      const cloudinary = require("cloudinary").v2;
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });

      // Define where the user recording was saved in a local file path
      const filePath = path.join(__dirname, "../recorded.wav");

      // Upload the local audio file to Cloudinary
      cloudinary.uploader
        .upload(filePath, {
          folder: "bananarama", // Specify the folder where you want to store the uploaded file in your Cloudinary account
          resource_type: "auto", // Automatically detect the resource type (audio)
          allowedFormats: ["mp4", "m4a", "mp3", "wav", "mpeg"], // Specify the allowed file formats
        })
        .then((uploadResult) => {
          // Wav file is saved as .webm file in Cloudinary, so fetch the .mp3 url
          const mp3Url = uploadResult.url.replace(".webm", ".mp3");
          // console.log(mp3Url);
          // Save the Cloudinary url as a new record
          const record = new Record({ recordPath: mp3Url });
          return record.save();
        })
        .then((savedRecord) => {
          // console.log('Record saved in the database:', savedRecord);
          // Associate the record with the user
          return User.findByIdAndUpdate(
            req.payload._id,
            { $push: { record: savedRecord._id } },
            { new: true }
          ).then((updatedUser) => {
            //      console.log('User updated with the associated record:', updatedUser);
            sendToApi(savedRecord);
            res.status(200).json({ message: "File uploaded successfully" });
          });
        })
        .catch((error) => {
          console.error("Error uploading audio to Cloudinary:", error);
        });
    } catch (err) {
      next(err);
    }
  }
);

// define function sendToApi which sends the file to Whisper API for transcription
async function sendToApi(recordId) {
  try {
    const filePath = path.join(__dirname, "../recorded.wav");
    const model = "whisper-1";

    const formData = new FormData();
    formData.append("model", model);
    formData.append("file", fs.createReadStream(filePath));

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": `multipart/form-data; boundary=${formData._boundary}`,
        },
      }
    );
    const text = response.data.text;
    // Update the record with the transcript
    const updatedRecord = await Record.findByIdAndUpdate(
      recordId,
      { transcript: text },
      { new: true }
    );
  } catch (error) {
    console.error("Error transcribing audio:", error);
  }
}

router.get("/display", isAuthenticated, async (req, res, next) => {
  try {  
    const user = await User.findById(req.payload._id).populate("record");
    const record = user.record.map(record => record);
    res.json(record);
  } catch (err) {
    next(err);
  }
});

router.post("/display", isAuthenticated, async (req, res, next) => {
  try {
    const { recordId } = req.body;
    const user = await User.findById(req.payload._id).populate("record");
    const recordIndex = user.record.findIndex(record => record._id.toString() === recordId);
    if (recordIndex === -1) {
      return res.status(404).json({ message: "Transcript not found." });
    }
    user.record.splice(recordIndex, 1);
    await user.save();

    res.json({ message: "Transcript deleted successfully.", deletedRecord: recordId });
  } catch (err) {
    next(err);
  }
});

router.get("/profile", isAuthenticated, async (req, res, next) => {
  try {
    // Get the last record transcript
    const user = await User.findById(req.payload._id);
    // const lastRecordId = user.record[user.record.length - 1]._id;
    // const foundRecord = await Record.findById(lastRecordId);
    // const transcript = foundRecord.transcript;
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.get("/private-page", isAuthenticated, async (req, res) => {
  res.status(200).json({ privateThings: req.privateThings });
});

router.get("/private-page-2", isAuthenticated, async (req, res) => {
  res.status(200).json({ privateThings: req.privateThings });
});

module.exports = router;

// Check if the uploaded file is being received correctly
/*
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }*/

// Cleanup: Delete the temporary local file
/*
    fs.unlinkSync(localFilePath);
    res.status(201).json(record);
  } catch (err) {
    console.error(err);
    // Handle the error appropriately
    res.status(500).json({ error: 'An error occurred' });
  }
}) */

// const enrichRequestWithPrivateThings = async (req, res, next) => {
//   const { _id } = req.payload;
//   try {
//     const user = await User.findById(_id);
//     req.privateThings = user.privateThings;
//     console.log("private page", req.payload);
//     next();
//   } catch (err) {
//     console.log(err);
//   }
// };