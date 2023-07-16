const express = require("express");
const router = express.Router();
const axios = require("axios");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Configuration, OpenAIApi, TranscriptionsApi } = require("openai");
const FormData = require("form-data");
const path = require("path");
const multer = require("multer");
const User = require("../models/User.model");
const Text = require("../models/Text.model");
const Record = require("../models/Record.model");
const { isAuthenticated } = require("../middlewares/jwt.auth");
const uploader = require("../middlewares/cloudinary.config.js");

const openai = new OpenAIApi(new Configuration({ apiKey: process.env.OPENAI_API_KEY }));

// Error handler middleware
const errorHandler = (err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'An error occurred' });
};

router.post("/signup", async (req, res) => {
  try {
    const saltRounds = 13;
    const salt = bcrypt.genSaltSync(saltRounds);
    const hash = bcrypt.hashSync(req.body.password, salt);
    const newUser = await User.create({ email: req.body.email, password: hash });
    res.status(201).json(newUser);
  } catch (err) {
    next(err);
  }
});

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
    next(err);
  }
});

router.get("/verify", isAuthenticated, (req, res) => {
  res.status(200).json({ user: req.payload });
});

router.get("/transcribe", isAuthenticated, uploader.single("recordPath"), async (req, res, next) => {
    try {
      // Method 1: transcribing a local file, saved in the project directory and then sending it to transcription

      // This is defining the path of the local file:
      const filePath = path.join(__dirname, "../audio.mp3");
      const model = "whisper-1";
      const formData = new FormData();
      formData.append("model", model);
      formData.append("file", fs.createReadStream(filePath));

      const response = axios.post("https://api.openai.com/v1/audio/transcriptions", formData, {
          headers: {
            ...formData.getHeaders(),
            authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": `multipart/form-data; boundary=${formData._boundary}`,
          },
        })
        .then((response) => {
          const text = response.data.text;
          res.json({ text });
        });
    } catch (err) {
      next(err);
    }
  }
);

router.post("/addRecord", isAuthenticated, uploader.single("recordPath"), async (req, res, next) => {
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
          sendToApi();
        })
        .catch((error) => {
          next(err);
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
            res.json({ text });
            return Record.findByIdAndUpdate(searchedRecord, { transcript: text }, { new: true })
          });
      }
    } catch(err){
      next(err);
    }    
  }
);

router.get("/write", isAuthenticated, async (req, res, next) => {
  try {
    // Get the last record transcript 
    const user = await User.findById(req.payload._id);
    const lastRecordId = user.record[user.record.length - 1]._id;
    const foundRecord = await Record.findById(lastRecordId);
    const prompt = foundRecord.transcript

    // Generate OpenAI chat completion
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
        
    // Create and save writtenText before sending the response
    const writtenText = await Text.create({ writtenText: text });
    await User.findByIdAndUpdate(req.payload._id, { $push: { writtenText: writtenText._id } }, { new: true });

    res.json({ text });
  } catch(err) {
    next(err);
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

// This route saves a file recorded by user to the project repo
router.post("/record", isAuthenticated, upload.single('audio'), async (req, res, next) => {
  try {
    res.status(200).json({ message: 'File uploaded successfully' });
  } catch (err) {
    next(err);
  }
}
);

// This route displays all recordings of a user
router.get("/display", isAuthenticated, async (req, res, next) => {
  try {
    // Get the last record transcript 
    const user = await User.findById(req.payload._id);
    const lastRecordId = user.record[user.record.length - 1]._id;
    const foundRecord = await Record.findById(lastRecordId);
    const transcript = foundRecord.transcript;
    //console.log(transcript);
   
    res.json(transcript);
  } catch (err) {
    next(err);
}
}
);

const enrichRequestWithPrivateThings = async (req, res, next) => {
  const { _id } = req.payload;
  try {
    const user = await User.findById(_id);
    req.privateThings = user.privateThings;
    next();
  } catch (err) {
    next(err);
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
    res.status(500).json({ error: 'An error occurred' });
  }
}) */