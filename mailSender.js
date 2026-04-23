const sgMail = require("@sendgrid/mail");

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendMail = async (to, subject, html, pdfBuffer) => {
  try {
    console.log("Sending to:", to);
    const msg = {
      to,
      from: "priyankalouis30@gmail.com", 
      subject,
      html,
    };

    
    if (pdfBuffer) {
      msg.attachments = [
        {
          content: pdfBuffer.toString("base64"),
          filename: "invoice.pdf",
          type: "application/pdf",
          disposition: "attachment",
        },
      ];
    }

    const response = await sgMail.send(msg);

    console.log("STATUS:", response[0].statusCode);

  } catch (error) {
    console.log("ERROR:", error.response?.body || error.message);
  }
};

module.exports = sendMail;