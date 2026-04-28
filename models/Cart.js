const mongoose = require("mongoose");

const cartSchema = new mongoose.Schema({
  items: [
    {
      productId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
        required: true
      },
      quantity: {
        type: Number,
        default: 1
      }
    }
  ]
});

module.exports = mongoose.model("Cart", cartSchema);


//USER PANEL ORDER DETAILS CREATE GST BILLS PDF MAIL USER
//DEPLOYMENT= GITHUB PUSH RENDER CLOUDINARY ATLAS code change   code frontend backend atlas   