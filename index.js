require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const upload = require("./config/multer");
const ProductModel = require("./models/Product");
const UserModel = require("./models/User");
const CartModel = require("./models/Cart");
const Order = require("./models/Order");
const sendMail = require("./mailSender");
const PDFDocument = require("pdfkit");

const app = express();

app.use(express.json());

app.use(cors({
  origin: "*"
}));

if (!process.env.MONGO_URI) {
 
  process.exit(1);
}

console.log("URI:", process.env.MONGO_URI); 

mongoose.connect(process.env.MONGO_URI, {
  family: 4   
})
.then(() => console.log("MongoDB Atlas connected"))
.catch(err => console.log("DataBase ERROR:", err));

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});
function generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}


app.post("/login", async (req, res) => {
  try {
    const { email } = req.body;
    let user = await UserModel.findOne({ email });

    const otp = generateOTP();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

    if (!user) {
      user = await UserModel.create({
        email,
        otp,
        otpExpires
      });

      } else {
      user.otp = otp;
      user.otpExpires = otpExpires;
      await user.save();
    }

    console.log("OTP Sent:", otp); 

       await sendMail(
      email,
      "Your OTP",
      `<h2>${otp}</h2><p>Valid for 5 minutes</p>`
    );
    res.json({ message: "OTP sent" });

  } catch (err) {
    console.log("Login ERROR:", err);
    res.status(500).json({ message: "Login error" });
  }
});

app.get("/my-orders/:email", async (req, res) => {
  try {
    const orders = await Order.find({ email: req.params.email })
      .populate("items.productId"); 

    res.json(orders);
  } catch (err) {
    res.status(500).json(err);
  }
});
app.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
const user = await UserModel.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "User not found" });
    }

     console.log("DB OTP:", user.otp);
     console.log("ENTERED OTP:", otp);

    if (user.otp.toString() !== otp.toString()) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (new Date() > user.otpExpires) {
      return res.status(400).json({ message: "OTP expired" });
    }

    user.otp = null;
   
   
    user.otpExpires = null;
    await user.save();

    res.json({ message: "Login successful" });

  } catch (err) {
    console.log("VERIFY ERROR:", err);
    res.status(500).json({ message: "Verify error" });
  }
});
app.put("/update-payment/:id", async (req, res) => {
  try {

    const { paymentMethod, status } = req.body;
 console.log("UPDATE PAYMENT:", req.params.id, paymentMethod, status);
 const order = await Order.findByIdAndUpdate(
      req.params.id,
      {
        payment: paymentMethod,
        paymentStatus: status
      },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json({ message: "Payment updated successfully", order });
  } catch (err) {
    console.log("PAYMENT UPDATE ERROR:", err);
    res.status(500).json({ message: "Payment update failed" });
  }
});

app.post("/create-razorpay-order", async (req, res) => {
  try {
    const { amount } = req.body;

    const order = await razorpay.orders.create({
        amount: amount * 100,
      currency: "INR"
    });
    res.json(order);

  } catch (err) {
    res.status(500).json({ message: "Razorpay error" });
  }
});

app.post("/verify-payment", async (req, res) => {
  try {
    const {
      razorpay_order_id,

      razorpay_payment_id,
      razorpay_signature,
      orderId
    } = req.body;

    const sign = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSign = crypto
       .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(sign)
      .digest("hex");

    if (expectedSign === razorpay_signature) {
      await Order.findByIdAndUpdate(orderId, {
        payment: "razorpay",
        paymentStatus: "Paid"
      });

      res.json({ success: true });
    } else {
      res.json({ success: false });
    }

  } catch (err) {
    res.status(500).json({ success: false });
  }
});




app.post("/order", async (req, res) => {
  try {

    const {
      fullName,
      email,
      phone,
      address,
      city,
      state,
      pincode,
      payment,
      items
    } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "No items" });
    }

    let totalAmount = 0;
    let productDetails = [];

    for (let item of items) {
      const product = await ProductModel.findById(item.productId);

      const itemTotal = product.price * item.quantity;
      totalAmount += itemTotal;

      productDetails.push({
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        total: itemTotal
      });
    }

    const order = new Order({
      fullName,
      email,
      phone,
      address,
      city,
      state,
      pincode,
      payment,
      paymentStatus: "Pending",
      orderStatus: "Placed",
      items,
      totalAmount
    });

    const savedOrder = await order.save();
const doc = new PDFDocument({ size: "A4", margin: 50 });

let buffers = [];
doc.on("data", (chunk) => buffers.push(chunk));

doc.fontSize(16).text("My Store Pvt Ltd", 50, 50);
doc.fontSize(10).text("Mangalore, Karnataka, India");
doc.text("Email: support@mystore.com");

doc.fontSize(14).text("TAX INVOICE", 400, 50);

doc.moveDown(3);

doc.fontSize(10);
doc.text(`Invoice #: INV-${savedOrder._id}`, 50, 120);
doc.text(`Order ID: ${savedOrder._id}`);
doc.text(`Date: ${new Date().toLocaleDateString()}`);

doc.text(`Payment: ${payment}`, 350, 120);
doc.text(`Status: ${order.orderStatus}`, 350, 135);

doc.text("Billed To:", 50, 170);
doc.text(fullName);
doc.text(`${address}, ${city}, ${state} - ${pincode}`);

const tableTop = 240;

doc.moveTo(50, tableTop).lineTo(550, tableTop).stroke();

doc.text("Item", 50, tableTop + 5);
doc.text("Qty", 200, tableTop + 5, { width: 40, align: "right" });
doc.text("Price", 250, tableTop + 5, { width: 60, align: "right" });
doc.text("Base", 320, tableTop + 5, { width: 60, align: "right" });
doc.text("CGST", 380, tableTop + 5, { width: 60, align: "right" });
doc.text("SGST", 440, tableTop + 5, { width: 60, align: "right" });
doc.text("Total", 500, tableTop + 5, { width: 60, align: "right" });

doc.moveTo(50, tableTop + 20).lineTo(550, tableTop + 20).stroke();

let y = tableTop + 30;
let taxableSubtotal = 0;
let totalGST = 0;

productDetails.forEach((item) => {
  const total = item.price * item.quantity;

  const base = total / 1.18;
  const gst = total - base;

  const cgst = gst / 2;
  const sgst = gst / 2;

  taxableSubtotal += base;
  totalGST += gst;

  doc.text(item.name, 50, y, { width: 140 });

  doc.text(item.quantity.toString(), 200, y, { width: 40, align: "right" });
  doc.text(`₹${item.price.toFixed(2)}`, 250, y, { width: 60, align: "right" });
  doc.text(`${base.toFixed(2)}`, 320, y, { width: 60, align: "right" });
  doc.text(`${cgst.toFixed(2)}`, 380, y, { width: 60, align: "right" });
  doc.text(`${sgst.toFixed(2)}`, 440, y, { width: 60, align: "right" });
  doc.text(`₹${total.toFixed(2)}`, 500, y, { width: 60, align: "right" });

  y += 25;
});

doc.moveTo(50, y).lineTo(550, y).stroke();

y += 20;

const grandTotal = taxableSubtotal + totalGST;

doc.text("Taxable Subtotal:", 350, y);
doc.text(`${taxableSubtotal.toFixed(2)}`, 500, y, { align: "right" });

doc.text("Total GST (18%):", 350, y + 15);
doc.text(`${totalGST.toFixed(2)}`, 500, y + 15, { align: "right" });

doc.text("Shipping:", 350, y + 30);
doc.text("FREE", 500, y + 30, { align: "right" });

doc.text("Grand Total:", 350, y + 50);
doc.text(`₹${grandTotal.toFixed(2)}`, 500, y + 50, { align: "right" });

doc.text("Thank you for shopping with us!", 50, 750, {
  align: "center"
});

doc.on("end", async () => {
  const pdfBuffer = Buffer.concat(buffers);

  await sendMail(
    email,
    "GST Invoice",
    `<h3>Your order invoice</h3>
     <p>Order ID: ${savedOrder._id}</p>
     <p>Total: ₹${grandTotal.toFixed(2)}</p>`,
    pdfBuffer
  );
});

doc.end();
    res.json({
      orderId: savedOrder._id
    });

  } catch (err) {
    console.log("ORDER ERROR:", err);
    res.status(500).json({ message: "Order error" });
  }
});
app.get("/orders", async (req, res) => {
  try {
   

    const orders = await Order.find().populate("items.productId");

    res.json(orders);

  } catch (err) {
    console.log("ERROR:", err);
    res.status(500).json({ message: "Error fetching orders" });
  }
});


app.get("/order/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json(order);

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Error fetching order" });
  }
});

app.put("/update-order/:id", async (req, res) => {
  try {
    console.log("UPDATE REQUEST:", req.body);

    const { orderStatus, paymentStatus } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { orderStatus, paymentStatus },
      { new: true }
    );

    if (!order) {
      console.log("Order not found");
      return res.status(404).json({ message: "Order not found" });
    }

    console.log("UPDATED ORDER:", order);

    
    if (order.email) {
      try {
        if (orderStatus === "Shipped") {
          await sendMail(
            order.email,
            "Order Shipped ",
            `<h3>Your order has been shipped</h3>`
          );
        }

        if (orderStatus === "Delivered") {
          await sendMail(
            order.email,
            "Order Delivered ",
            `<h3>Your order has been delivered</h3>`
          );
        }
      } catch (err) {
        console.log("MAIL ERROR:", err.message);
      }
    }

    res.json({ message: "Order updated successfully" });

  } catch (err) {
    console.log("UPDATE ERROR FULL:", err); 
    res.status(500).json({ message: "Update failed" });
  }
});

app.delete("/order/:id", async (req, res) => {
  try {
    const order = await Order.findByIdAndDelete(req.params.id);

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    res.json({ message: "Order deleted successfully" });
  } catch (err) {
     console.log("DELETE ERROR:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});

app.get("/products", async (req, res) => {
  try {
    const products = await ProductModel.find();
    res.json(products);
  } catch (err) {
    console.log("PRODUCT ERROR:", err);
    res.status(500).json({ message: "Error fetching products" });
  }
});

app.post("/addproduct", upload.single("image"), async (req, res) => {
  try {

    const product = new ProductModel({
      name: req.body.name,
      description: req.body.description,
      price: req.body.price,
      quantity: req.body.quantity,
      category: req.body.category,  
      image: req.file ? req.file.path : null
    });

    await product.save();

    res.json({ message: "Product added", product });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Error" });
  }
});
app.get("/search", async (req, res) => {
  try {
    const query = req.query.q;

    if (!query) {
      return res.json([]);
    }

    const products = await ProductModel.find({
      $or: [
        { name: { $regex: query, $options: "i" } },
         { category: { $regex: query, $options: "i" } }
         ]
    });

    res.json(products);

  } catch (err) {
    
    res.status(500).json({ message: "Search failed" });
  }
});
app.get("/product/:id", async (req, res) => {
  try {
    console.log("PRODUCT ID:", req.params.id);
    const product = await ProductModel.findById(req.params.id);

    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json(product);
  } catch (err) {
  
    res.status(500).json({ message: "Server error" });
  }
});
app.post("/cart", async (req, res) => {
  try {
    const { productId } = req.body;

    console.log("Adding Product:", productId);
    let cart = await CartModel.findOne();

    if (!cart) {
      cart = new CartModel({ items: [] });
    }

    const index = cart.items.findIndex(
      item => item.productId.toString() === productId
    );

    if (index !== -1) {
    cart.items[index].quantity += 1;
    } else {
      cart.items.push({ productId, quantity: 1 });
    }

    await cart.save();

    console.log("UPDATED CART:", cart);

    res.json(cart);

  } catch (error) {
    console.log("CART ERROR:", error);
     res.status(500).json({ error: "Error adding to cart" });
  }
});
app.get("/cart", async (req, res) => {
  try {

    const cart = await CartModel.findOne().populate("items.productId");

    console.log("FETCH CART:", cart);

    if (!cart || cart.items.length === 0) {
      return res.json({ items: [] });
    }

    res.json(cart);

  } catch (error) {
     
    res.status(500).json({ error: "Error fetching cart" });
  }
});

app.delete("/cart/:productId", async (req, res) => {
  try {
    const {productId } = req.params;

    let cart = await CartModel.findOne();

    if (!cart) {
      return res.status(404).json({ message: "Cart not found" });
    }

    cart.items = cart.items.filter(
       item => item.productId.toString() !== productId
    );

    await cart.save();

    res.json({message: "Item removed successfully" });

  } catch (err) {
   
    res.status(500).json({ message: "Delete failed" });
  }
});


app.get("/users",async (req, res) => {
  try {
    const users = await UserModel.find();
     res.json(users);
  } catch (err) {
     res.status(500).json({ message: "Error fetching users" });
  }
});

app.listen(process.env.PORT, () => {
  console.log(`Server running on port ${process.env.PORT}`);
});