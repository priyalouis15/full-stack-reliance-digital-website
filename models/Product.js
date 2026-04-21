const mongoose = require("mongoose");

const ProductSchema = new mongoose.Schema(
{
  name: {
    type: String,
    required: true,
    trim: true
  },

  description: {
    type: String,
    required: true
  },

  price: {
    type: Number,
    required: true
  },

  category: {
    type: String,
    required: true
  },

  quantity: {
    type: Number,
    required: true
  },
   image: {
    type: String
  }

},
{
  timestamps: true
}
);

module.exports = mongoose.model("Product", ProductSchema);