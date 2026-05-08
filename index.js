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

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const otpExpires = new Date(Date.now() + 5 * 60 * 1000);

    if (!user) {
      user = new UserModel({
        email,
        otp,
        otpExpires
      });
    } else {
      user.otp = otp;
      user.otpExpires = otpExpires;
    }

    await user.save();

    console.log("OTP Sent:", otp);
    console.log("LOGIN HIT");
console.log("OTP:", otp);

    await sendMail(
      email,
      "Your OTP",
      `<h2>${otp}</h2><p>Valid for 5 minutes</p>`
    );

    res.json({ message: "OTP sent" });

  } catch (err) {
    console.log("LOGIN ERROR:", err);
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

    if (!user.otp) {
      return res.status(400).json({ message: "OTP not generated" });
    }

    if (user.otp.toString() !== otp.toString()) {
      return res.status(400).json({ message: "Invalid OTP" });
    }

    if (new Date() > user.otpExpires) {
      return res.status(400).json({ message: "OTP expired" });
    }



    await user.save();

    console.log("OTP STORED:", user.otp);

    res.json({ message: "Login successful" });

  } catch (err) {
    console.log("VERIFY ERROR:", err);
    res.status(500).json({ message: "Verify error" });
  }
});
app.get("/products/category/:name", async (req, res) => {
  try {
    const products = await ProductModel.find({
      category: req.params.name
    });

    res.json(products);
  } catch (err) {
    res.status(500).json({ message: "Error" });
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
app.get("/", (req, res) => {
  res.send("Backend is running ");
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


app.get("/admin/dashboard", async (req, res) => {
  try {

    const totalProducts = await ProductModel.countDocuments();
    const totalOrders = await Order.countDocuments();
    const totalUsers = await UserModel.countDocuments();

    const revenueData = await Order.aggregate([
  { $match: { paymentStatus: "Paid" } },
  {
    $group: {
      _id: null,
      total: { $sum: "$totalAmount" }
    }
  }
]);

const totalRevenue =
  revenueData.length > 0 ? revenueData[0].total : 0;
    const salesByMonth = await Order.aggregate([
      {
        $group: {
          _id: { month: { $month: "$createdAt" } },
          count: { $sum: 1 }
        }
      },
      { $sort: { "_id.month": 1 } }
    ]);

    const recentOrders = await Order.find()
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      totalProducts,
      totalOrders,
      totalUsers,
      totalRevenue,
      salesByMonth,
      recentOrders
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Dashboard error" });
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
const path = require("path");

const doc = new PDFDocument({
  size: "A4",
  margin: 50
});

let buffers = [];

doc.on("data", (chunk) => buffers.push(chunk));

const logoPath = path.join(__dirname, "assets", "reliancelogo.jpg");


doc.image(logoPath, 50, 35, {
  width: 80
});


doc
  .fontSize(18)
  .fillColor("#000")
  .text("Reliance Digital", 150, 45);

doc
  .fontSize(10)
  .fillColor("gray")
  .text("Mangalore, Karnataka, India", 150, 68);

doc
  .text("Email: RelianceDigital@gmail.com", 150, 82);


doc
  .fontSize(16)
  .fillColor("#000")
  .text("OFFICIAL RECEIPT", 400, 50);


doc
  .moveTo(50, 115)
  .lineTo(550, 115)
  .strokeColor("#ccc")
  .stroke();


doc.fontSize(10).fillColor("#000");

doc.text(`Invoice #: INV-${savedOrder._id}`, 50, 130);
doc.text(`Order ID: ${savedOrder._id}`, 50, 145);
doc.text(`Date: ${new Date().toLocaleDateString()}`, 50, 160);

doc.text(`Payment: ${payment}`, 350, 130);
doc.text(`Status: ${order.orderStatus}`, 350, 145);
doc.text(`Shipping: FREE`, 350, 160);

doc
  .fontSize(12)
  .text("Billed To:", 50, 200);

doc
  .fontSize(10)
  .text(fullName, 50, 220);

doc.text(address, 50, 235);

doc.text(`${city}, ${state} - ${pincode}`, 50, 250);

const tableTop = 300;

doc
  .rect(50, tableTop, 500, 25)
  .fill("#f2f2f2");

doc.fillColor("#000");

doc.text("Item", 60, tableTop + 8);

doc.text("Qty", 220, tableTop + 8);

doc.text("Price", 280, tableTop + 8);

doc.text("CGST", 360, tableTop + 8);

doc.text("SGST", 430, tableTop + 8);

doc.text("Total", 500, tableTop + 8);


let y = tableTop + 40;

let subtotal = 0;
let totalGST = 0;

productDetails.forEach((item) => {

  const total = item.price * item.quantity;

  const gst = total * 0.18;

  const cgst = gst / 2;

  const sgst = gst / 2;

  subtotal += total;

  totalGST += gst;

  doc.text(item.name, 60, y);

  doc.text(item.quantity.toString(), 220, y);

  doc.text(`Rs ${item.price.toFixed(2)}`, 270, y);

  doc.text(`Rs ${cgst.toFixed(2)}`, 350, y);

  doc.text(`Rs ${sgst.toFixed(2)}`, 420, y);

  doc.text(`Rs ${total.toFixed(2)}`, 490, y);

  y += 28;
});


doc
  .moveTo(50, y)
  .lineTo(550, y)
  .strokeColor("#ccc")
  .stroke();

y += 25;


const grandTotal = subtotal + totalGST;

doc.fontSize(11).fillColor("#000");

doc.text(`Subtotal: Rs ${subtotal.toFixed(2)}`, 350, y);

doc.text(`GST (18%): Rs ${totalGST.toFixed(2)}`, 350, y + 20);

doc.text(`Shipping: FREE`, 350, y + 40);

doc
  .fontSize(13)
  .text(`Grand Total: Rs ${grandTotal.toFixed(2)}`, 350, y + 70);


doc
  .fontSize(11)
  .fillColor("gray")
  .text(
    "Thank you for shopping with Reliance Digital!",
    50,
    750,
    {
      align: "center"
    }
  );


doc.on("end", async () => {

  const pdfBuffer = Buffer.concat(buffers);

  await sendMail(
    email,
    "GST Invoice",
    `
      <h3>Your Order Invoice</h3>
      <p>Order ID: ${savedOrder._id}</p>
      <p>Total: Rs ${grandTotal.toFixed(2)}</p>
    `,
    pdfBuffer
  );
});

doc.end();
res.json({
  success: true,
  message: "Order placed successfully ",
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