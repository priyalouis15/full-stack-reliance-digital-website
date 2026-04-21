const mongoose = require("mongoose");

const OrderSchema = new mongoose.Schema({

  fullName: String,
  phone: String,
   email: String,
  address: String,
  city: String,
  state: String,
  pincode: String,

  payment: String,

  items: [
    {
      productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product"
      },
      quantity: Number
    }
  ],

  totalAmount: Number,

  orderStatus: {
    type: String,
    default: "Pending"
  },

  
  paymentStatus: {
    type: String,
    default: "Pending"
  }

}, { timestamps: true });

module.exports = mongoose.model("Order", OrderSchema);