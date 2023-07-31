const { Schema, model } = require("mongoose");

const recordSchema = new Schema(
  {
    title: {
      type: String,
      // required: [true, 'Task is required.'],
      lowercase: true
     },
    recordPath: {
      type: String,
      required: [true, 'Record is required.']
    },
    transcript: {
      type: String
    },
    // writtenText:  {
    //   type: String
    // },
    writtenText: [{
      _id: {
        type: Schema.Types.ObjectId, 
        required: true,
      },
      text: {
        type: String,
        required: true,
      },
    }],

    //record: [{ ref: "Record", type: Schema.Types.ObjectId }],
  },
  {
    // this second object adds extra properties: `createdAt` and `updatedAt`    
    timestamps: true
  }
);

const Record = model("Record", recordSchema);

module.exports = Record;