require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  }),
);
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make io available inside route handlers via req.app.get('io')
app.set("io", io);

// ── Routes ────────────────────────────────────────────────────────────────────
const authRoutes = require("./routes/auth.routes");
const customerRoutes = require("./routes/customers.routes");
const jobRoutes = require("./routes/jobs.routes");
const dispatchRoutes = require("./routes/dispatch.routes");
const estimateRoutes = require("./routes/estimates.routes");
const invoiceRoutes = require("./routes/invoices.routes");
const technicianRoutes = require("./routes/technicians.routes");
const pricebookRoutes = require("./routes/pricebook.routes");
const inventoryRoutes = require("./routes/inventory.routes");
const agreementRoutes = require("./routes/agreements.routes");
const reportRoutes = require("./routes/reports.routes");
const settingsRoutes = require("./routes/settings.routes");
const notificationRoutes = require("./routes/notifications.routes");
const callRoutes = require("./routes/calls.routes");
const campaignRoutes = require("./routes/campaigns.routes");
const paymentRoutes = require("./routes/payments.routes");
const metadataRoutes = require("./routes/metadata.routes");

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/metadata", metadataRoutes);
app.use("/api/v1/customers", customerRoutes);
app.use("/api/v1/jobs", jobRoutes);
app.use("/api/v1/dispatch", dispatchRoutes);
app.use("/api/v1/estimates", estimateRoutes);
app.use("/api/v1/invoices", invoiceRoutes);
app.use("/api/v1/technicians", technicianRoutes);
app.use("/api/v1/pricebook", pricebookRoutes);
app.use("/api/v1/inventory", inventoryRoutes);
app.use("/api/v1/agreements", agreementRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/calls", callRoutes);
app.use("/api/v1/campaigns", campaignRoutes);
app.use("/api/v1/payments", paymentRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) =>
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  }),
);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) =>
  res.status(404).json({ success: false, error: "Route not found" }),
);

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || "Internal server error",
  });
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  // Technician joins a dispatch board room for a specific date
  socket.on("join:dispatch", (date) => {
    socket.join(`dispatch:${date}`);
    console.log(`Socket ${socket.id} joined dispatch:${date}`);
  });

  socket.on("leave:dispatch", (date) => {
    socket.leave(`dispatch:${date}`);
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
  });
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 PulseService API running on http://localhost:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || "development"}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health\n`);
});
