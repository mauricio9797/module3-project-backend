const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../models/User.model");
const Text = require("../models/Text.model");
const Record = require("../models/Record.model");
const { isAuthenticated } = require("../middlewares/jwt.auth");
const uploader = require("../middlewares/cloudinary.config.js");
const { Configuration, OpenAIApi, TranscriptionsApi } = require("openai");
const FormData = require("form-data");
const path = require("path");
const multer = require('multer');

router.post("/signup", async (req, res) => {
  const saltRounds = 13;
  const salt = bcrypt.genSaltSync(saltRounds);
  const hash = bcrypt.hashSync(req.body.password, salt);
  const newUser = await User.create({ email: req.body.email, password: hash });
  console.log("here is our new user in the DB", newUser);
  res.status(201).json(newUser);
});

//login route
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
      //if there is no email in the DB matching
      res.status(400).json({ message: "email or password do not match" });
    }
  } catch (err) {
    console.log(err);
  }
});

router.get("/verify", isAuthenticated, (req, res) => {
  const { _id } = req.payload;
  if (req.payload) {
    res.status(200).json({ user: req.payload });
  }
});

//isAuthenticated
router.get("/transcribe", isAuthenticated, uploader.single("recordPath"), async (req, res, next) => {
    try {
      // Method 1: transcribing a local file, saved in the project directory and then sending it to transcription
      const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      // This is defining the path of the local file:
      const filePath = path.join(__dirname, "../audio.mp3");
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

router.post("/addRecord",isAuthenticated,uploader.single("recordPath"),async (req, res, next) => {
    // Method 2: upload a file from user's drive > upload it to cloudinary > then save it to local file in project > send it to be transcribed
    try {
      // Take record from the form and upload it to mongoose
      const record = new Record({title: req.body.title, recordPath: req.file.path});
      await record.save();

      const recordId = record._id;
      // Associate the record with the user
       await User.findByIdAndUpdate(req.payload._id, { $push: { record: recordId } }, { new: true });

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
        const response = await axios({url,method: "GET",responseType: "stream"});
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
          writer.on("finish", resolve);
          writer.on("error", reject);
        });
      }

      // define function sendToApi which sends the file to be transcribed
      async function sendToApi() {
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
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
            return Record.findByIdAndUpdate(searchedRecord, { transcript: text },{ new: true })
          });
      }
    } catch(err){
      console.error(err);
      res.status(500).json({ error: "An error occurred" });
    }    
  }
);

router.get("/write", isAuthenticated, async (req, res, next) => {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
   const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const openai = new OpenAIApi(configuration);
  
  // get the last record transcript 
  const user = await User.findById(req.payload._id);
  const lastRecordId = user.record[user.record.length - 1]._id;
  console.log(lastRecordId)
  const prompt = await Record.findById(lastRecordId);

  try {
    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant who can write good text based on the prompt.",
        },
        {
          role: "user",
          content: `Hi, can you please write a short feedback text with this context: ${prompt}`,
        },
      ],
    });
  
    const text = completion.data.choices[0].message.content;
    console.log(lastRecordId);
    console.log(text);
    res.json( {text} );
    

    
    //start
    const writtenText = new Text({writtenText: text});
    await writtenText.save();

    const writtenTextId = writtenText._id;
    // Associate the record with the user
     await User.findByIdAndUpdate(req.payload._id, { $push: { writtenText: writtenTextId } }, { new: true });
    // await writtenText.save();
    // end
  } catch(err) {
    console.error("Error with OpenAI Chat Completion", err);
    res.status(500).json({ error: "An error occurred" });
  }
  
 }
);


// Multer configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './'); // Specify the directory where you want to save the files
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname); // Use the original filename for saving the file
  },
});
const upload = multer({ storage: storage });



router.post("/record", isAuthenticated, upload.single('audio'), async (req, res, next) => {
  console.log("Welcome!");
  res.status(200).json({ message: 'File uploaded successfully' });
}
);

const enrichRequestWithPrivateThings = async (req, res, next) => {
  const { _id } = req.payload;
  try {
    const user = await User.findById(_id);
    req.privateThings = user.privateThings;
    console.log("private page", req.payload);
    next();
  } catch (err) {
    console.log(err);
  }
};

router.get("/private-page", isAuthenticated, async (req, res) => {
    res.status(200).json({ privateThings: req.privateThings });
  }
);

router.get("/private-page-2", isAuthenticated, async (req, res) => {
    res.status(200).json({ privateThings: req.privateThings });
  }
);

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