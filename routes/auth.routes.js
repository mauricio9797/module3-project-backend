const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const FormData = require("form-data");
const path = require("path");

// Models 
const User = require("../models/User.model");
const Text = require("../models/Text.model");
const Record = require("../models/Record.model");

// Middlewares & API configs
const { isAuthenticated } = require("../middlewares/jwt.auth");
const cloudinaryAudioUploader = require("../middlewares/cloudinary.config.js");
const cloudinaryImageUploader = require("../middlewares/cloudinary.imageConfig.js");
const multerAudioUploader = require("../middlewares/multer.config");
const { Configuration, OpenAIApi } = require("openai");

// OpenAI config
const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_API_KEY })
);


// Authentication routes
router.post("/signup", cloudinaryImageUploader.single("userImage"), async (req, res) => {
    const saltRounds = 13;
    const salt = bcrypt.genSaltSync(saltRounds);
    const hash = bcrypt.hashSync(req.body.password, salt);
    const newUser = await User.create({
      email: req.body.email,
      ...(req.file ? { userImage: req.file.path } : {}),
      password: hash,
    });
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
        res.status(200).json({ authToken });
      }
    } else {
      res.status(400).json({ message: "email or password do not match" });
    }
  } catch (err) {
    res.status(500).json({ message: "Something went wrong on the server." });
  }
});

router.get("/verify", isAuthenticated, async (req, res) => {
  try {
    const user = await User.findById(req.payload._id);

    if (user !== null) {
      // User found, respond with the user data
      res.status(200).json({ user: user.toObject(), userImage: user.userImage });
    } else {
      // User not found, handle this situation accordingly
      res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred" });
  }
});

// User operations 
router.get("/profile", isAuthenticated, async (req, res, next) => {
  try {
    const user = await User.findById(req.payload._id);
    res.json(user);
  } catch (err) {
    next(err);
  }
});

router.get("/private-page", isAuthenticated, async (req, res) => {
  res.status(200).json({ privateThings: req.privateThings });
});


router.get("/editUser/:userId", isAuthenticated, async (req, res, next) => {
  const { userId } = req.params;
  const user = await User.findById(userId);
  res.status(200).json(user);
});

router.put("/editUser/:userId", isAuthenticated, cloudinaryImageUploader.single("userImage"), async (req, res, next) => {
    try {
      const { userId } = req.params;
      const userToEdit = await User.findByIdAndUpdate(userId, 
        {
        email: req.body.email,
        ...(req.file ? { userImage: req.file.path } : {}),
      });
      res.status(200).json(userToEdit);
    } catch (err) {
      console.log("Error editing user account", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

router.delete("/deleteUser/:userId", isAuthenticated, async (req, res, next) => {
  try {
    const { userId } = req.params;
    const userToDelete = await User.findByIdAndDelete(userId);
    res.status(200).json(userToDelete);
  } catch (err) {
    console.log("Error editing user account", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// Record creation operations  
router.post("/addRecord", isAuthenticated, cloudinaryAudioUploader.single("recordPath"), async (req, res, next) => {
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
      const localFilePath = "./audio/temporary.mp3";
      saveAudioToLocal(audioUrl, localFilePath)
        .then(() => {
          // console.log("Audio file saved successfully!");
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
        const filePath = path.join(__dirname, "../audio/temporary.mp3");
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
            // then send the transcription as response and save to DB 
            const text = response.data.text;
            res.json({ recordId, text });
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

router.get("/write/:recordId", isAuthenticated, async (req, res, next) => { 
  try {
    // Get the record transcript 
    const { recordId } = req.params;
    const record = await Record.findById(recordId);
    const prompt = record.transcript;

    // Generate OpenAI chat completion
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [ { role: "user", content: `Hi, can you please write a short text with this context: ${prompt}.` } ] 
    });
    const text = completion.data.choices[0].message.content;

    // Create and save writtenText before sending the response
    const writtenText = await Text.create({ writtenText: text });

    //  Associate the written text with the record 
      res.json({ text });
      await Record.findByIdAndUpdate(recordId, 
        { writtenText: { _id: writtenText._id, text: text } }, 
        { new: true }
    );
  } catch (err) {
    res.status(500).json({ error: "An error occurred" });
  }
});

router.get("/writeText/:recordId", isAuthenticated, async (req, res, next) => {
    // Get the record transcript
    const { recordId } = req.params;
    const record = await Record.findById(recordId);
    const prompt = record.transcript;

    // Generate OpenAI chat completion
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "user", content: `Hi, can you please write a short text with this context: ${prompt}.` },
      ],
    });
    const text = completion.data.choices[0].message.content;
    // Push the new written text to the array
    record.writtenText.push({ text: text });
    await record.save();
    res.json({ text });
});

router.get("/transcribe/:recordId", isAuthenticated, async (req, res, next) => {
    const { recordId } = req.params;
    const record = await Record.findById(recordId);
    const transcript = record.transcript ;
    res.send({ transcript });
})

// Record route: this route saves a file recorded by user to the project repo
router.post("/record", isAuthenticated, multerAudioUploader.single("audio"), async (req, res, next) => {
    try {
      const cloudinary = require("cloudinary").v2;
      cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
      });

      // Define where the user recording was saved in a local file path
      const filePath = path.join(__dirname, "../audio/recorded.wav");

      // Upload the local audio file to Cloudinary
      cloudinary.uploader
        .upload(filePath, {
          folder: "bananarama", 
          resource_type: "auto", 
          allowedFormats: ["mp4", "m4a", "mp3", "wav", "mpeg"], 
        })
        .then((uploadResult) => {
          // Wav file is saved as .webm file in Cloudinary, so fetch the .mp3 url
          const mp3Url = uploadResult.url.replace(".webm", ".mp3");
          const record = new Record({ recordPath: mp3Url });
          return record.save();
        })
        .then((savedRecord) => {
          // Associate the record with the user
          return User.findByIdAndUpdate(
            req.payload._id,
            { $push: { record: savedRecord._id } },
            { new: true }
          ).then(() => {
            return sendToApi(savedRecord._id)
            .then((record) => {
              res.json({ record }); 
            })     
          });
        })
        .catch((error) => {
          console.error("Error saving record:", error);
        });
    } catch (err) {
      next(err);
    }}
);

// define function sendToApi which sends the file to Whisper API for transcription
async function sendToApi(recordId) {
  try {
    const filePath = path.join(__dirname, "../audio/recorded.wav");
    const model = "whisper-1";

    const formData = new FormData();
    formData.append("model", model);
    formData.append("file", fs.createReadStream(filePath));

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      { headers: {
          ...formData.getHeaders(),
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": `multipart/form-data; boundary=${formData._boundary}`,
        },
      }
    );
    
    const text = response.data.text;
    // Update the record with the transcript and get full record as response 
    const record = await Record.findByIdAndUpdate(recordId, { transcript: text }, { new: true });
    return record
  } catch (error) {
    console.error("Error transcribing audio:", error);
  }
}

// All records displaying (reading) operations  
router.get("/display", isAuthenticated, async (req, res, next) => {
  try {  
    const user = await User.findById(req.payload._id).populate("record");
    const record = user.record.map(record => record);
    res.json(record);
  } catch (err) {
    next(err);
  }
});

router.get("/editRecord/:recordId", isAuthenticated, async (req, res, next) => {
  const { recordId } = req.params;
  const record = await Record.findById(recordId);
  res.status(200).json(record);
});

// Record editing and deleting operations  
router.put("/editRecord/:recordId", isAuthenticated, async (req,res) => {
  const { recordId } = req.params;
  const { transcript, texts } = req.body;
  const record = await Record.findById(recordId);
  if (!record) {return res.status(404).json({ message: 'Record not found' });}
  if (transcript) record.transcript = transcript;
  if (texts) {record.writtenText = texts;}
  const updatedRecord = await record.save();
  return res.json(updatedRecord);
});

router.delete("/delete/:recordId", isAuthenticated, async (req, res, next) => {
  try {
    const { recordId } = req.params;
    const recordToDelete = await Record.findByIdAndDelete(recordId);
    res.json({ message: "Transcript deleted successfully.", deletedRecord: recordId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
