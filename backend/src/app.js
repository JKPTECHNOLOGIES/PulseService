require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const app = express();
const server = http.createServer(app);

// CORS configuration - allow frontend URLs (localhost + network IPs)
const corsOrigin =
  process.env.NODE_ENV === "production"
    ? process.env.FRONTEND_URL || "http://localhost:8080"
    : [
        "http://localhost:8080",
        "http://127.0.0.1:8080",
        /^http:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:8080$/,
      ];

const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  }),
);
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Make io available inside route handlers via req.app.get('io')
app.set("io", io);

// ── Routes ────────────────────────────────────────────────────────────────────
// Root endpoint - HTML home page
app.get("/", (req, res) => {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>PulseService API</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 10px;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
          max-width: 800px;
          width: 100%;
          padding: 40px;
        }
        .header {
          text-align: center;
          margin-bottom: 40px;
        }
        .logo {
          font-size: 48px;
          margin-bottom: 10px;
        }
        h1 {
          color: #333;
          font-size: 32px;
          margin-bottom: 10px;
        }
        .status {
          display: inline-block;
          background: #4ade80;
          color: white;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 14px;
          font-weight: 600;
          margin-top: 10px;
        }
        .version {
          color: #888;
          font-size: 14px;
          margin-top: 10px;
        }
        .section {
          margin-bottom: 40px;
        }
        .section h2 {
          color: #667eea;
          font-size: 18px;
          margin-bottom: 15px;
          border-bottom: 2px solid #667eea;
          padding-bottom: 10px;
        }
        .endpoint-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
          gap: 15px;
        }
        .endpoint {
          background: #f5f5f5;
          border-left: 4px solid #667eea;
          padding: 15px;
          border-radius: 5px;
          transition: all 0.3s ease;
          cursor: pointer;
        }
        .endpoint:hover {
          background: #f0f0f0;
          transform: translateX(5px);
        }
        .endpoint-name {
          font-weight: 600;
          color: #333;
          margin-bottom: 8px;
        }
        .endpoint-path {
          font-family: 'Courier New', monospace;
          color: #667eea;
          font-size: 13px;
          word-break: break-all;
          background: white;
          padding: 8px;
          border-radius: 3px;
          border: 1px solid #e0e0e0;
        }
        .health-check {
          background: #f0f7ff;
          border-left-color: #3b82f6;
        }
        .health-check .endpoint-name {
          color: #3b82f6;
        }
        .footer {
          text-align: center;
          color: #888;
          font-size: 12px;
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #e0e0e0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">🚀</div>
          <h1>PulseService API</h1>
          <div class="status">● Running</div>
          <div class="version">Version 1.0.0</div>
        </div>

        <div class="section">
          <h2>Health Check</h2>
          <div class="health-check endpoint">
            <div class="endpoint-name">Status Monitor</div>
            <div class="endpoint-path">/api/health</div>
          </div>
        </div>

        <div class="section">
          <h2>API Endpoints</h2>
          <div class="endpoint-grid">
            <div class="endpoint">
              <div class="endpoint-name">Authentication</div>
              <div class="endpoint-path">/api/v1/auth</div>
            </div>
            <div class="endpoint">
              <div class="endpoint-name">Technicians</div>
              <div class="endpoint-path">/api/v1/technicians</div>
            </div>
            <div class="endpoint">
              <div class="endpoint-name">Customers</div>
              <div class="endpoint-path">/api/v1/customers</div>
            </div>
            <div class="endpoint">
              <div class="endpoint-name">Jobs</div>
              <div class="endpoint-path">/api/v1/jobs</div>
            </div>
            <div class="endpoint">
              <div class="endpoint-name">Dispatch</div>
              <div class="endpoint-path">/api/v1/dispatch</div>
            </div>
            <div class="endpoint">
              <div class="endpoint-name">Reports</div>
              <div class="endpoint-path">/api/v1/reports</div>
            </div>
          </div>
        </div>

        <div class="footer">
          <p>Field Service Management Platform | Built with Node.js, Express & PostgreSQL</p>
        </div>
      </div>
    </body>
    </html>
  `;
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

const auditLogger = require("./middleware/audit.middleware");
const authRoutes = require("./routes/auth.routes");
const userRoutes = require("./routes/users.routes");
const roleRoutes = require("./routes/roles.routes");
const auditRoutes = require("./routes/audit.routes");
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
const equipmentRoutes = require("./routes/equipment.routes");
const searchRoutes = require("./routes/search.routes");
const attachmentRoutes = require("./routes/attachments.routes");
const publicRoutes = require("./routes/public.routes");
const timeRoutes = require("./routes/time.routes");
const pushRoutes = require("./routes/push.routes");
const recurringRoutes = require("./routes/recurring.routes");

// Record mutating actions across every resource (must run before the routers so
// it can hook the response; req.user is populated by each router's auth guard).
app.use("/api/v1", auditLogger);

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/v1/roles", roleRoutes);
app.use("/api/v1/audit", auditRoutes);
app.use("/api/v1/metadata", metadataRoutes);
app.use("/api/v1/customers", customerRoutes);
app.use("/api/v1/jobs", jobRoutes);
app.use("/api/v1/dispatch", dispatchRoutes);
app.use("/api/v1/estimates", estimateRoutes);
app.use("/api/v1/invoices", invoiceRoutes);
app.use("/api/v1/technicians", technicianRoutes);
app.use("/api/v1/pricebook", pricebookRoutes);
app.use("/api/v1/inventory", inventoryRoutes);
app.use("/api/v1/equipment", equipmentRoutes);
app.use("/api/v1/agreements", agreementRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/calls", callRoutes);
app.use("/api/v1/campaigns", campaignRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/search", searchRoutes);
app.use("/api/v1/attachments", attachmentRoutes);
app.use("/api/v1/public", publicRoutes);
app.use("/api/v1/time", timeRoutes);
app.use("/api/v1/push", pushRoutes);
app.use("/api/v1/recurring", recurringRoutes);

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
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 PulseService API running on http://0.0.0.0:${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || "development"}`);
  console.log(`   Health check: http://0.0.0.0:${PORT}/api/health\n`);
});
