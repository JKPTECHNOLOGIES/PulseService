import type { ComponentType, SVGProps } from "react";
import {
  HomeIcon,
  CalendarDaysIcon,
  UsersIcon,
  BriefcaseIcon,
  MapIcon,
  GlobeAltIcon,
  DocumentTextIcon,
  DocumentDuplicateIcon,
  CreditCardIcon,
  WrenchScrewdriverIcon,
  BookOpenIcon,
  ArchiveBoxIcon,
  TruckIcon,
  ShoppingCartIcon,
  QrCodeIcon,
  CpuChipIcon,
  ClipboardDocumentCheckIcon,
  MegaphoneIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  ArrowPathIcon,
  BellIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";

/**
 * Plain-English "how does this page work" content shown to end users via the
 * help ("?") button in the Header, automatically the first time a user ever
 * visits a given page (see `usePageHelpSeen`), and all together in the Help
 * Center page (`/help`).
 *
 * Each entry has a stable `key` (used for the "seen it once" tracking) that's
 * independent of the display `title`, so re-wording a title later doesn't
 * reset onboarding for everyone.
 */

export interface PageHelpSection {
  heading?: string;
  items: string[];
}

export interface PageHelpContent {
  key: string;
  title: string;
  summary: string;
  sections: PageHelpSection[];
  tips?: string[];
}

const dashboardHelp: PageHelpContent = {
  key: "dashboard",
  title: "Dashboard",
  summary:
    "Your home screen for a quick snapshot of today's work, money owed, and revenue trends.",
  sections: [
    {
      heading: "What you'll see",
      items: [
        "Today's Jobs shows how many jobs are scheduled for today.",
        "Open Invoices shows how many invoices are unpaid and the total amount outstanding.",
        "Monthly Revenue shows what's been billed so far this month.",
        "The chart shows revenue trends over the last 12 months.",
        "Recent Jobs and Recent Invoices list the latest activity, click any row to open it.",
      ],
    },
    {
      heading: "Quick actions",
      items: [
        "Use the buttons at the bottom to jump straight into creating a New Job, New Customer, New Estimate, or New Invoice.",
        "Click View All above either table to go to the full Jobs or Invoices list.",
      ],
    },
  ],
};

const customersHelp: PageHelpContent = {
  key: "customers",
  title: "Customers",
  summary:
    "Manage your customer list and view everything about a single customer, including their jobs, estimates, and invoices.",
  sections: [
    {
      heading: "The customer list",
      items: [
        "Click New Customer to add someone new, or Import to upload a batch of customers from a spreadsheet.",
        "Use the search box to find a customer by name, and the Residential/Commercial tabs to filter by type.",
        "Click any column header to sort, and use the column menu to export the list to CSV.",
        "Save your current search and filters as a named view using Saved Views so you can reuse it later.",
        "Select multiple customers with the checkboxes to export just those rows, and click the pencil icon to jump straight into editing a customer.",
        "Click a customer's row to open their full detail page.",
      ],
    },
    {
      heading: "On a customer's detail page",
      items: [
        "The header shows contact info, customer type, current balance, and pricing tier, plus buttons to start a New Job, Edit, or Delete this customer.",
        "The Overview tab shows contact details, notes, saved locations/addresses, and any uploaded photos or files.",
        "The Jobs, Estimates, and Invoices tabs list everything tied to this customer, click any row to open it.",
        "Deleting a customer permanently removes them along with all their jobs, estimates, invoices, and payments, so use it carefully.",
      ],
    },
    {
      heading: "Adding or editing a customer",
      items: [
        "Choose Residential or Commercial, commercial customers also get a Company Name field.",
        "First name, last name, and customer type are required, everything else is optional.",
        "If you leave phone blank, it's saved as N/A rather than blocking you from saving.",
        "Add a primary address so it's ready to use when scheduling jobs.",
        "Assign a Pricing Tier if this customer gets special discounted pricing.",
      ],
    },
  ],
  tips: [
    "To start a job for an existing customer, open their detail page and click New Job, it will already be linked to them.",
    "To reuse a filtered/sorted customer list later, set it up once and save it with Saved Views.",
  ],
};

const jobsHelp: PageHelpContent = {
  key: "jobs",
  title: "Jobs",
  summary:
    "Find, filter, and create jobs from the main job list, and fill in the details on the job form.",
  sections: [
    {
      heading: "The jobs list",
      items: [
        "Click New Job to create a job, choose the customer, schedule, and technicians on the form that follows.",
        "Use the status tabs (New, Scheduled, Dispatched, etc.) to filter jobs by where they are in the workflow.",
        "Search by job number, customer name, or summary using the search box.",
        "Check Show archived to include jobs that have been archived, archived jobs are hidden from active lists but not deleted.",
        "Click a column header to sort, and use the column menu to export the visible jobs to CSV.",
        "Save a combination of search, status, and sort as a Saved View to quickly get back to it.",
      ],
    },
    {
      heading: "Row actions",
      items: [
        "Click a job's row to open its full detail page.",
        "Click the pencil icon to edit a job's details directly from the list.",
        "Click the archive icon to archive a job you no longer need in your active lists, or restore an archived one.",
      ],
    },
    {
      heading: "Creating or editing a job",
      items: [
        "Pick the customer, job type, priority, and an initial status (New or Scheduled).",
        "Summary is required, it's the short description shown throughout the app, Description is for longer detail.",
        "Set Scheduled Start and Scheduled End to put the job on the calendar.",
        "Check the technicians who should be assigned in the Assign Technicians section.",
        "Office Notes are internal and are separate from the technician's tech notes.",
      ],
    },
  ],
  tips: [
    "Starting a job from a customer's page (via New Job there) automatically links it to that customer.",
    'Use the status tabs plus Saved Views together to build quick filters like "My open urgent jobs."',
  ],
};

const jobDetailHelp: PageHelpContent = {
  key: "job-detail",
  title: "Job Detail",
  summary:
    "Everything about one specific job: its status, who's assigned, notes, time logged, and materials used.",
  sections: [
    {
      heading: "Working the job",
      items: [
        "The status timeline across the top shows progress from New through Scheduled, Dispatched, In Progress, to Completed.",
        "Click Update Status to move the job to its next stage (or back if needed).",
        "Click Assign under Technicians to add another technician to the job.",
        "Click Edit to change the job's summary, schedule, type, priority, or notes.",
        "Click Archive to hide a finished or cancelled job from active lists, you can Restore it later if needed.",
      ],
    },
    {
      heading: "Notes, time, and proof of work",
      items: [
        "Office Notes and Tech Notes are shown separately, office notes are internal, tech notes come from the technician in the field.",
        "Use Clock In / Clock Out in the Time Tracking section to log hours worked on this job, only one job can be clocked into at a time.",
        "The Materials & Equipment section shows parts used, installed serialized units, and any linked purchase orders, use Add part or Install unit to record more.",
        "The Signature and Photos & Attachments sections let you capture customer sign-off and upload job site photos or files.",
      ],
    },
  ],
  tips: [
    "To bill a completed job, go to Invoices > New Invoice, pick the same customer, and select this job, any parts used on it can be pulled in automatically as line items.",
    "If you're clocked into a different job, clock out there first, you can't be clocked into two jobs at once.",
  ],
};

const recurringHelp: PageHelpContent = {
  key: "recurring",
  title: "Recurring Jobs",
  summary:
    "Set up repeating schedules so jobs are created automatically, instead of building the same job by hand every time.",
  sections: [
    {
      heading: "Creating a schedule",
      items: [
        "Click New recurring job to set up a template for a customer.",
        "Choose how often it repeats: weekly, every 2 weeks, monthly, quarterly, or yearly.",
        "Use the 'Every (N)' field to skip cycles, for example every 3 months.",
        "Set a first run date to control when the first job should be generated.",
        "Add a type, priority, and description just like a normal job.",
      ],
    },
    {
      heading: "Managing existing schedules",
      items: [
        "The table shows each schedule's customer, frequency, and next run date.",
        "The lightning bolt icon generates a job from that schedule right now, without waiting for the next run date.",
        "Pause a schedule to temporarily stop it from generating new jobs, and click again to resume it.",
        "Deleting a schedule stops future jobs but does not affect jobs already created from it.",
        "Run due now generates jobs for every schedule that is due, in one click.",
      ],
    },
  ],
  tips: [
    "To create a one-off job instead of a recurring one, use the Jobs page's New Job button.",
    "If a schedule is Paused, it will not generate jobs even if you click Run due now — reactivate it first.",
  ],
};

const dispatchHelp: PageHelpContent = {
  key: "dispatch",
  title: "Dispatch Board",
  summary:
    "The Dispatch Board is where you schedule and assign jobs to technicians. Drag jobs onto a technician's row to assign them, or reschedule by dragging along the timeline.",
  sections: [
    {
      heading: "Views and navigation",
      items: [
        "Switch between Day, Week, and Month views using the toggle at the top right.",
        "Use the arrows next to the date to move backward or forward, one day/week/month at a time depending on the view.",
        "In Day view, a vertical line shows the current time when you're viewing today.",
        "The summary bar shows scheduled, completed, unassigned, and undated job counts, available technicians, and booked revenue for the current view.",
        "The color key at the top explains what each job status color means on the board.",
      ],
    },
    {
      heading: "Assigning and scheduling jobs",
      items: [
        "Drag a job card onto a technician's row to assign it to that technician.",
        "Drag a job left or right on the timeline to change its scheduled time.",
        "In Week or Month view, drag a job onto a different day to move it there.",
        "Drag a job onto the Unassigned panel to remove its technician (its date is kept).",
        "Drag a job onto the Undated panel to clear its scheduled date (its technician is kept).",
        "Click any job card to open its details, where you can change status, assign a technician, or edit the schedule directly.",
      ],
    },
    {
      heading: "Unassigned and undated jobs",
      items: [
        "The Unassigned panel lists jobs that have a date but no technician yet.",
        "The Undated panel lists jobs that have a technician (or neither) but no scheduled date yet.",
        "Drag a job from either panel onto a technician's row to schedule and assign it at once.",
      ],
    },
    {
      heading: "Job details panel",
      items: [
        "Assign or remove technicians for the job without leaving the board.",
        "Change the job's status directly from the dropdown next to the status badge.",
        "Use the schedule editor to set or adjust the start and end time.",
        "Click Open job to go to the full job page, or Archive job to hide it from active lists.",
      ],
    },
  ],
  tips: [
    "The board updates live, so changes made by other dispatchers appear automatically without refreshing.",
    "If you drag a job by mistake, you'll be asked to confirm before its technician or date is cleared.",
    "To quickly create a brand-new job, click New Job in the top right of the board.",
  ],
};

const mapHelp: PageHelpContent = {
  key: "map",
  title: "Map",
  summary:
    "See where scheduled jobs are located on a map for the next 14 days, so you can spot clusters and plan routes.",
  sections: [
    {
      heading: "Using the map",
      items: [
        "Each pin represents a job with a mapped address, scheduled or unscheduled, over the next 14 days.",
        "Click a pin to see the job number, customer, and address, plus a link to open the full job.",
        "Click Directions in a pin's popup to open turn-by-turn directions in your default maps app.",
        "The count at the top shows how many jobs currently have a mapped location.",
      ],
    },
    {
      heading: "When jobs don't show up",
      items: [
        "A job only appears on the map if its address has been converted into map coordinates.",
        "Click Geocode addresses to look up coordinates for any jobs that are missing them.",
        "If a job still doesn't appear after geocoding, double-check that its address is filled in correctly.",
      ],
    },
  ],
  tips: [
    "Run Geocode addresses whenever you add new customers or job sites so they show up on the map.",
  ],
};

const estimatesHelp: PageHelpContent = {
  key: "estimates",
  title: "Estimates",
  summary:
    "Browse all estimates, and create or edit an estimate's details, line items, and pricing before sending it to a customer.",
  sections: [
    {
      heading: "Finding estimates",
      items: [
        "Search by estimate number, customer, or title using the search box.",
        "Filter the list by status, such as Draft, Sent, Approved, or Rejected.",
        "Click any row to open that estimate's full details.",
        "Save your current search and filters as a view using the Saved Views menu, so you can reuse it later.",
      ],
    },
    {
      heading: "Quick actions from the list",
      items: [
        "Draft estimates show a send icon so you can email them to the customer without opening the estimate.",
        "Approved estimates show a convert icon to turn them into an invoice directly from the list.",
        "Click New Estimate to start a brand-new one.",
      ],
    },
    {
      heading: "Filling out the estimate form",
      items: [
        "Choose the customer first — this unlocks the option to link the estimate to one of their existing jobs.",
        "Give the estimate a title and, optionally, a summary and a valid-until date.",
        "Add line items (labor, materials, or other charges) in the Line Items section; totals update automatically.",
        "Set a discount (fixed amount or percentage) and a tax rate; the Pricing box recalculates the total live.",
        "Add customer-facing notes and payment terms if needed.",
      ],
    },
  ],
  tips: [
    "To create an estimate for existing work, pick the customer, then select the related job before filling in line items.",
    "Save Changes on an edited estimate takes you back to its detail page so you can review it before sending.",
  ],
};

const estimateDetailHelp: PageHelpContent = {
  key: "estimate-detail",
  title: "Estimate Detail",
  summary:
    "Review a single estimate, send it to the customer, get it approved, and turn it into a job or invoice.",
  sections: [
    {
      heading: "What you'll see",
      items: [
        "The header shows the estimate number, status, customer, and key dates like created and valid-until.",
        "The Line Items table lists every charge with quantity, unit price, and line total.",
        "The Totals section breaks down subtotal, any discount, tax, and the final total.",
        "Notes and Terms & Conditions (if filled in) appear below the totals for the customer to read.",
        "Photos, signatures, and attachments related to the estimate appear near the bottom of the page.",
      ],
    },
    {
      heading: "Moving the estimate forward",
      items: [
        "Click Send while the estimate is a Draft to email it to the customer.",
        "Once it's Sent or Viewed, click Approve to mark it as accepted (use this if the customer approved by phone or in person).",
        "Once it's Approved, click Convert to Invoice to generate an invoice from it automatically.",
        "Click PDF at any time to download a copy of the estimate to save or print.",
        "Click Edit to change the customer, line items, pricing, or notes.",
      ],
    },
  ],
  tips: [
    "To turn an approved estimate into a job or invoice, open it and click Convert to Invoice.",
    "If a customer needs changes, click Edit, update the line items or pricing, then save and re-send.",
  ],
};

const invoicesHelp: PageHelpContent = {
  key: "invoices",
  title: "Invoices",
  summary:
    "See every invoice you've created, check its status, and create or edit invoices before sending them to customers.",
  sections: [
    {
      heading: "Invoice List",
      items: [
        "Every invoice is listed with its customer, due date, total, remaining balance, and status.",
        "Use the search box to find an invoice by number or customer name.",
        "Use the status buttons (Draft, Sent, Paid, etc.) to filter the list down to what you need.",
        "Balances still owed show in red, and fully paid balances show in green.",
        "Click any invoice row to open its full details, record a payment, or download it.",
        "Draft invoices show a small send icon so you can email them straight from the list.",
      ],
    },
    {
      heading: "Creating or Editing an Invoice",
      items: [
        "Click New Invoice to start one, then choose the customer it belongs to.",
        "If the customer has a related job, you can link the invoice to it and pull in the parts used on that job automatically.",
        "Add line items for labor, parts, or other charges, and set quantities and prices for each.",
        "Add a discount (flat amount or percentage) and set the tax rate; the subtotal, tax, and total update automatically.",
        "Add any notes or terms you want the customer to see on the invoice.",
        "Existing invoices can only be edited before any payment has been recorded against them.",
      ],
    },
  ],
  tips: [
    "To bill a customer for a completed job, create a new invoice and link it to that job to pull in the parts used automatically.",
    "To send a draft invoice to a customer, use the send icon next to it in the list or the Send button on the invoice itself.",
  ],
};

const invoiceDetailHelp: PageHelpContent = {
  key: "invoice-detail",
  title: "Invoice Detail",
  summary:
    "Work with a single invoice: review the charges, collect payment, download a PDF, or void it if needed.",
  sections: [
    {
      heading: "Reviewing the Invoice",
      items: [
        "The top of the page shows the customer, current status, issue date, due date, amount paid, and balance due.",
        "The line items section lists every charge that makes up the invoice.",
        "The totals section breaks down the subtotal, any discount, tax, and the final balance still owed.",
        "The Payment History table lists every payment made against this invoice, including the method and reference number.",
        "Any photos or files attached to the invoice appear near the bottom of the page.",
      ],
    },
    {
      heading: "Taking Action",
      items: [
        "Click PDF to download a copy of the invoice to print or send.",
        "Click Record Payment to log a payment — enter the amount, method, and an optional reference number like a check number.",
        "Click Send to email a draft invoice to the customer.",
        "Click Edit to change the invoice, but only while no payments have been recorded yet.",
        "Click Void to cancel an invoice that shouldn't be collected on; this can't be undone.",
        "Use Reverse next to a payment if it was entered by mistake or the invoice needs to be voided; this restores the balance.",
      ],
    },
  ],
  tips: [
    "To collect a payment against an invoice, open it and click Record Payment, then fill in the amount and method.",
    "If a payment was recorded incorrectly, click Reverse next to that payment in the Payment History table rather than voiding the whole invoice.",
  ],
};

const paymentsHelp: PageHelpContent = {
  key: "payments",
  title: "Payments",
  summary:
    "See every payment collected across all invoices, with totals for the current page.",
  sections: [
    {
      heading: "Payment Summary",
      items: [
        "The cards at the top show how much has been collected on this page, the total number of payments recorded, and the average payment amount.",
      ],
    },
    {
      heading: "Payment List",
      items: [
        "Each row shows the date, customer, related invoice number, payment method, reference number, status, and amount.",
        "Click an invoice number to jump straight to that invoice.",
        "Payment status shows whether a payment is completed, pending, failed, reversed (a bookkeeping correction -- no money necessarily moved), or refunded (an actual refund to the customer).",
      ],
    },
  ],
  tips: [
    "This page is for reviewing payments already made. To collect a new payment, open the relevant invoice and click Record Payment there.",
  ],
};

const techniciansHelp: PageHelpContent = {
  key: "technicians",
  title: "Technicians",
  summary:
    "See your team of technicians, their skills, and whether they're currently available for new jobs.",
  sections: [
    {
      heading: "Technician Cards",
      items: [
        "Each card shows the technician's name, employee ID, and contact email.",
        "A badge shows whether the technician is currently Available or Busy.",
        "Skills listed on the card show what kind of work that technician is qualified to do.",
        "Click Schedule on a technician's card to go to the dispatch board and assign them to a job.",
      ],
    },
  ],
  tips: [
    "Technicians are created from user accounts with the technician role, so a new technician won't appear here until their account is set up.",
  ],
};

const pricebookHelp: PageHelpContent = {
  key: "pricebook",
  title: "Pricebook",
  summary:
    "Manage the catalog of services and parts you charge customers for, organized into categories.",
  sections: [
    {
      heading: "Categories & Items",
      items: [
        "Categories on the left let you group items like Labor, Parts, or Equipment; click All Items to see everything at once.",
        "Click the + next to Categories to add a new category.",
        "Click Add Item to create a new pricebook item with a SKU, name, cost, price, and unit.",
        "Click any item row to edit its details, including whether it's taxable or still active.",
        "Use Import to bulk-upload items from a spreadsheet instead of adding them one at a time.",
      ],
    },
    {
      heading: "Pricing Tiers",
      items: [
        "Click Pricing Tiers to manage discount levels (like a 'Commercial Preferred' tier) that can be assigned to specific customers.",
        "Each tier can have its own blanket discount plus special overridden prices for individual items.",
      ],
    },
  ],
  tips: [
    "To give a specific customer a special price on one item, set up a pricing tier with an item override and assign that tier to the customer's profile.",
  ],
};

const inventoryHelp: PageHelpContent = {
  key: "inventory",
  title: "Inventory",
  summary:
    "See everything in stock across the warehouse and trucks, track reorder points, and adjust or transfer stock as it moves.",
  sections: [
    {
      heading: "What you can see",
      items: [
        "Every inventory item shows its SKU, name, total quantity on hand, how many locations stock it, its reorder point, and average cost.",
        "Items highlighted in yellow are below their reorder point and need to be restocked soon.",
        "A banner at the top lists all low-stock items so you don't have to scan the whole table.",
        'Items marked "Serial" are individually tracked by serial number (see Serialized Units).',
      ],
    },
    {
      heading: "Managing stock",
      items: [
        'Use "Adjust" to add stock, remove stock, or set the exact quantity at a location, with an optional note explaining why.',
        'Use "Transfer" to move stock from one location (like the warehouse) to another (like a technician\'s truck).',
        "Click the clock icon to view the full history of additions, removals, transfers, and counts for an item.",
        "Click the camera icon to attach or view photos of an item.",
        'Use "Supplier pricing" to see or add which suppliers sell an item and at what price, and mark one as primary.',
        'Use "New Item" to add a new part or product, and "Edit" to update its SKU, name, unit, reorder point, and reorder quantity.',
      ],
    },
    {
      heading: "Other tools on this page",
      items: [
        '"Scan" opens your device camera to scan a barcode and jump straight to adjusting that item\'s stock.',
        '"Import" lets you bulk-add or update items from a spreadsheet (CSV).',
        '"Locations" opens the Stock Locations page, where you manage the warehouse and every truck that carries stock, including which vehicle and technician each truck belongs to.',
        '"Cycle Count" opens a guided count tool: pick a location, enter what you physically counted for each item, and the system automatically posts the difference (variance) between expected and counted quantities.',
      ],
    },
  ],
  tips: [
    'To restock before you run out: watch the low-stock banner, then create a purchase order from the Purchasing page (or use "Reorder Suggestions" there).',
    'To do a full warehouse count: go to Cycle Count, choose the location, type in each counted quantity, then apply — variances post automatically and matched items get a fresh "last counted" date.',
  ],
};

const suppliersHelp: PageHelpContent = {
  key: "suppliers",
  title: "Suppliers",
  summary:
    "Keep a list of the vendors you buy parts and equipment from, along with their contact details and payment terms.",
  sections: [
    {
      heading: "What's here",
      items: [
        'Each supplier shows a supplier number, name, contact person, email/phone, and payment terms (like "Net 30").',
        "The Items column shows how many inventory items are linked to that supplier, and POs shows how many purchase orders reference them.",
        "Use the search box to quickly find a supplier by name.",
      ],
    },
    {
      heading: "Managing suppliers",
      items: [
        'Click "New Supplier" to add a vendor, including name, contact info, city/state, and payment terms.',
        "Click the pencil icon to edit a supplier's details.",
        "Click the trash icon to deactivate a supplier — this hides them from new purchase orders but keeps their history intact.",
      ],
    },
  ],
};

const purchasingHelp: PageHelpContent = {
  key: "purchasing",
  title: "Purchase Orders",
  summary:
    "Create purchase orders to buy parts from suppliers, track their status, and receive the items into stock when they arrive.",
  sections: [
    {
      heading: "The purchase order list",
      items: [
        "Every PO shows its number, supplier, status, ship-to location, order date, and total cost.",
        "Filter the list by status (draft, ordered, partially received, received, closed, cancelled) using the dropdown.",
        "Click any row to open its details.",
        '"Reorder Suggestions" shows every item at or below its reorder point, grouped by supplier, with a suggested quantity and estimated cost — click "Create draft PO" to turn a group into a new order instantly.',
      ],
    },
    {
      heading: "Creating a purchase order",
      items: [
        '"New PO", choose a supplier, a ship-to location, and an optional expected delivery date.',
        "Add line items by picking an existing inventory item (which fills in the name and price automatically) or typing a custom description for a non-stock item.",
        "Set the quantity and unit price for each line; the total updates automatically.",
      ],
    },
    {
      heading: "On the PO detail page",
      items: [
        'The status badge and buttons at the top let you mark a draft as "Ordered", close a fully received order, or cancel it.',
        "The line items table shows what was ordered vs. received so far, with unit price and totals.",
        '"Receive" to record delivered items: enter the quantity received, choose which location it goes into, and (for serialized items) type in the serial numbers.',
        "Receiving stock automatically adds it to inventory at the chosen location and updates the line's received quantity.",
        "The Receipt History section lists every past receipt; if one was entered by mistake, click the reverse-arrow icon to undo it.",
      ],
    },
  ],
  tips: [
    "Fast restocking: open Reorder Suggestions, review the suggested quantities per supplier, then Create draft PO to generate the order automatically.",
    "Receiving a delivery: open the PO, click Receive, fill in quantities (and serial numbers if prompted), then confirm — inventory updates immediately.",
  ],
};

const serialsHelp: PageHelpContent = {
  key: "serials",
  title: "Serialized Units",
  summary:
    "Track individual, uniquely-serialized pieces of equipment from the moment they're received until they're installed at a customer's site.",
  sections: [
    {
      heading: "What's here",
      items: [
        "Serialized units are usually created automatically when a serialized inventory item is received against a purchase order, but you can also add one by hand from this page.",
        "Each row shows the serial number, the inventory item it belongs to, its current status, its stock location, and its warranty expiration date.",
        "Search by serial number or filter by status (e.g. in stock, reserved, installed) to find a specific unit.",
      ],
    },
    {
      heading: "Managing a unit",
      items: [
        'Click "New Unit" to manually add a serialized unit that wasn\'t received through a purchase order.',
        "Click a row to edit a unit's serial number, item, stock location, or notes, or to delete it entirely.",
        'Use the status dropdown to change a unit\'s status directly from the list. "Installed" can only be set through the Install action below, since it needs a linked customer.',
        'For units that are in stock or reserved, click "Install" to mark the unit as installed at a customer\'s location, optionally linking a service address and a warranty expiration date.',
      ],
    },
  ],
};

const equipmentHelp: PageHelpContent = {
  key: "equipment",
  title: "Equipment",
  summary:
    "Keep records of customer-owned equipment — model, serial number, install date, warranty, and service history — separate from your own warehouse stock.",
  sections: [
    {
      heading: "What's here",
      items: [
        "Each record shows the equipment name, type, manufacturer/model, the customer it belongs to, serial number, install date, warranty status, and condition.",
        "The warranty column flags items as Active, Expiring Soon, Expired, or No Warranty based on the expiration date.",
        "Use the search box to find equipment by name, serial number, or manufacturer, and the warranty buttons to filter by warranty status.",
      ],
    },
    {
      heading: "Managing a record",
      items: [
        'Click "Add Equipment" to create a record, including the owning customer, service location, type, condition, and warranty dates.',
        "Click any row to edit its details.",
        "While editing, the Service History section lists past jobs performed at that unit's location, so you can see repair history at a glance.",
        'Click "Delete" inside the edit form to remove an equipment record (this does not delete the related jobs).',
      ],
    },
  ],
};

const agreementsHelp: PageHelpContent = {
  key: "agreements",
  title: "Service Agreements",
  summary:
    "Manage recurring maintenance contracts with your customers, including billing schedules and planned visits.",
  sections: [
    {
      heading: "Agreements List",
      items: [
        "See every service agreement, with the customer, plan name, term dates, and amount.",
        "Filter the list by status using the tabs at the top (e.g. All, Active, Expired).",
        "Click 'New Agreement' to set up a new recurring contract for a customer.",
        "Click any row to open the full agreement details.",
        "Each agreement shows its billing frequency (e.g. monthly, annually) and the next billing date.",
      ],
    },
    {
      heading: "Agreement Details",
      items: [
        "View the full contract details: amount, billing frequency, start/end dates, and auto-renew setting.",
        "Read any terms or notes attached to the agreement.",
        "Click 'Edit' to update the agreement's name, status, pricing, dates, or notes.",
        "Use the 'Visits' panel to schedule a new maintenance visit tied to this agreement.",
        "Mark a visit as complete by clicking the checkmark next to it once the work is done.",
      ],
    },
  ],
  tips: [
    "To set up a new contract: click 'New Agreement', choose the customer, fill in the plan name, billing frequency, and dates, then save.",
    "To schedule the next maintenance visit: open the agreement, click 'Schedule' in the Visits panel, name the visit and pick a date.",
  ],
};

const marketingHelp: PageHelpContent = {
  key: "marketing",
  title: "Marketing",
  summary:
    "Track marketing campaigns and log inbound or outbound calls and messages with customers.",
  sections: [
    {
      heading: "Campaigns",
      items: [
        "See all marketing campaigns with their type, status, budget, and dates.",
        "Click 'New Campaign' to add a campaign and give it a tracking number for attributing calls.",
        "Edit an existing campaign to update its budget, dates, or status.",
        "Archive a campaign to hide it from the active list without deleting it -- check 'Show archived' to find it again and restore it anytime.",
        "Deleting a campaign is permanent. Calls already logged against it are kept, just no longer linked to a campaign.",
      ],
    },
    {
      heading: "Calls",
      items: [
        "Log every inbound or outbound phone call, including which customer and campaign it relates to.",
        "Record the call's direction, status, phone numbers, duration, and reason for calling.",
        "Add notes about what was discussed so any team member can follow up.",
        "Delete a call log entry if it was logged in error. This can't be undone.",
      ],
    },
    {
      heading: "Messages",
      items: [
        "Log text messages, emails, or other written communication sent to or received from customers.",
        "Record the direction (inbound/outbound), channel, subject, and message body.",
        "Delete a message log entry if it was logged in error. This can't be undone.",
      ],
    },
  ],
  tips: [
    "To track how well a campaign is performing, give it a tracking number, then link inbound calls to that campaign when logging them.",
  ],
};

const reportsHelp: PageHelpContent = {
  key: "reports",
  title: "Reports",
  summary:
    "Review business performance across revenue, jobs, technicians, customers, and more using the tabs at the top.",
  sections: [
    {
      heading: "Revenue & Sales",
      items: [
        "The Revenue tab shows total revenue over a selectable number of months, broken down visually.",
        "The Sales tab shows sales performance over a custom date range, including totals by source.",
      ],
    },
    {
      heading: "Estimates & Jobs",
      items: [
        "The Estimates tab breaks down estimates by status (e.g. sent, approved, declined).",
        "The Jobs tab shows job counts by status and the overall completion rate.",
      ],
    },
    {
      heading: "Technicians & Customers",
      items: [
        "The Technicians tab shows performance metrics for each technician.",
        "The Customers tab shows customer lifetime value and related metrics.",
      ],
    },
    {
      heading: "AR Aging & Inventory",
      items: [
        "The AR Aging tab shows unpaid invoices grouped by how overdue they are, helping you follow up on collections.",
        "The Inventory tab shows purchase order status, part costs, and stock levels by location.",
      ],
    },
  ],
  tips: [
    "Use the date range or month selectors on the Revenue and Sales tabs to narrow results to a specific period.",
  ],
};

const settingsHelp: PageHelpContent = {
  key: "settings",
  title: "Settings",
  summary:
    "Configure your account, company information, billing details, users, roles, and integrations. Available tabs depend on your permissions.",
  sections: [
    {
      heading: "Account",
      items: [
        "Update your own name, email, and phone number.",
        "Change your password from this tab.",
      ],
    },
    {
      heading: "Company",
      items: [
        "Set your company's name, address, and contact information shown on customer-facing documents.",
      ],
    },
    {
      heading: "Billing",
      items: [
        "Configure billing and tax settings used when generating invoices and estimates.",
      ],
    },
    {
      heading: "Users",
      items: [
        "View everyone with access to Prime Comfort Solutions and their assigned role.",
        "Invite a new user by email and assign them a role.",
        "Edit a user's role or active status, or reset their password.",
      ],
    },
    {
      heading: "Roles",
      items: [
        "See each role (e.g. Admin, Technician, Office Staff) and the permissions it grants.",
        "Turn individual permissions on or off for a role, or select a whole group of permissions at once.",
        "System roles may have limited editing to protect core functionality.",
      ],
    },
    {
      heading: "Business Units",
      items: [
        "Manage the different business units or divisions your company operates under.",
        "Add a new business unit or remove one that's no longer used.",
      ],
    },
    {
      heading: "Activity Log",
      items: [
        "Review a history of important actions taken in the system, such as creates, updates, deletes, and logins.",
        "See who performed each action and when.",
      ],
    },
    {
      heading: "QuickBooks",
      items: [
        "Connect and manage the QuickBooks integration for syncing financial data.",
      ],
    },
  ],
};

const notificationsHelp: PageHelpContent = {
  key: "notifications",
  title: "Notifications",
  summary:
    "See in-app alerts about jobs, invoices, and estimates, and control whether you get push notifications on this device.",
  sections: [
    {
      heading: "Notifications List",
      items: [
        "Unread notifications are highlighted and marked with a colored dot.",
        "Click a notification to open the related job, invoice, or estimate and mark it as read.",
        "Click 'Mark all read' to clear the unread count in one step.",
      ],
    },
    {
      heading: "Push Notifications",
      items: [
        "If your device supports it, you'll see a banner offering to turn on push notifications.",
        "Enable push notifications to get alerted about new jobs and updates even when the app isn't open.",
        "Turn push notifications off at any time from the same banner.",
      ],
    },
  ],
};

const myDayHelp: PageHelpContent = {
  key: "my-day",
  title: "My Day",
  summary:
    "A technician's personal agenda showing today's scheduled jobs in order, with quick access to navigation and calling the customer.",
  sections: [
    {
      heading: "Viewing Your Schedule",
      items: [
        "Jobs are listed in the order they're scheduled, each numbered and showing the time window.",
        "Use the arrows to move to the previous or next day, or tap 'Today' to jump back to today.",
        "Each job shows the customer's name, a short summary, and the service address.",
      ],
    },
    {
      heading: "Working a Job",
      items: [
        "Tap a job to open its full details.",
        "Tap 'Navigate' to open turn-by-turn directions to the job address in your maps app.",
        "Tap 'Call' to dial the customer directly from your phone.",
      ],
    },
  ],
  tips: [
    "If nothing shows up, check that jobs have been assigned and scheduled for that day.",
  ],
};

interface HelpRoute {
  test: (pathname: string) => boolean;
  content: PageHelpContent;
}

// Checked first, most specific: dedicated detail-page guides that read very
// differently from their parent list page.
const detailRoutes: HelpRoute[] = [
  { test: (p) => /^\/jobs\/(?!new$)[^/]+$/.test(p), content: jobDetailHelp },
  {
    test: (p) => /^\/invoices\/(?!new$)[^/]+$/.test(p),
    content: invoiceDetailHelp,
  },
  {
    test: (p) => /^\/estimates\/(?!new$)[^/]+$/.test(p),
    content: estimateDetailHelp,
  },
];

// Fallback: one entry per top-level section, covering its list/new/edit
// (and any other sub-route) variants.
const sectionRoutes: HelpRoute[] = [
  { test: (p) => p.startsWith("/dashboard"), content: dashboardHelp },
  { test: (p) => p.startsWith("/my-day"), content: myDayHelp },
  { test: (p) => p.startsWith("/customers"), content: customersHelp },
  { test: (p) => p.startsWith("/jobs"), content: jobsHelp },
  { test: (p) => p.startsWith("/recurring"), content: recurringHelp },
  { test: (p) => p.startsWith("/dispatch"), content: dispatchHelp },
  { test: (p) => p.startsWith("/map"), content: mapHelp },
  { test: (p) => p.startsWith("/estimates"), content: estimatesHelp },
  { test: (p) => p.startsWith("/invoices"), content: invoicesHelp },
  { test: (p) => p.startsWith("/payments"), content: paymentsHelp },
  { test: (p) => p.startsWith("/technicians"), content: techniciansHelp },
  { test: (p) => p.startsWith("/pricebook"), content: pricebookHelp },
  { test: (p) => p.startsWith("/inventory"), content: inventoryHelp },
  { test: (p) => p.startsWith("/suppliers"), content: suppliersHelp },
  { test: (p) => p.startsWith("/purchasing"), content: purchasingHelp },
  { test: (p) => p.startsWith("/serials"), content: serialsHelp },
  { test: (p) => p.startsWith("/equipment"), content: equipmentHelp },
  { test: (p) => p.startsWith("/agreements"), content: agreementsHelp },
  { test: (p) => p.startsWith("/marketing"), content: marketingHelp },
  { test: (p) => p.startsWith("/reports"), content: reportsHelp },
  { test: (p) => p.startsWith("/settings"), content: settingsHelp },
  { test: (p) => p.startsWith("/notifications"), content: notificationsHelp },
];

/** Returns the help content for a given route pathname, if any is defined. */
export function getPageHelp(pathname: string): PageHelpContent | undefined {
  for (const route of detailRoutes) {
    if (route.test(pathname)) return route.content;
  }
  for (const route of sectionRoutes) {
    if (route.test(pathname)) return route.content;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Metadata for browsing every guide at once (Help Center page, /help): an
// icon (matching the Sidebar's nav icons for visual consistency), the
// canonical route to jump to (omitted for detail-page guides, which need a
// specific record id and have no single page to land on), and a group used
// to organize the Help Center's list the same way the app's own nav reads.

export interface PageHelpMeta {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  route?: string;
  group: string;
}

const META: Record<string, PageHelpMeta> = {
  dashboard: { icon: HomeIcon, route: "/dashboard", group: "Overview" },
  "my-day": { icon: CalendarDaysIcon, route: "/my-day", group: "Overview" },
  customers: {
    icon: UsersIcon,
    route: "/customers",
    group: "Customers & Jobs",
  },
  jobs: { icon: BriefcaseIcon, route: "/jobs", group: "Customers & Jobs" },
  "job-detail": { icon: BriefcaseIcon, group: "Customers & Jobs" },
  recurring: {
    icon: ArrowPathIcon,
    route: "/recurring",
    group: "Customers & Jobs",
  },
  dispatch: { icon: MapIcon, route: "/dispatch", group: "Scheduling" },
  map: { icon: GlobeAltIcon, route: "/map", group: "Scheduling" },
  estimates: {
    icon: DocumentTextIcon,
    route: "/estimates",
    group: "Sales & Billing",
  },
  "estimate-detail": { icon: DocumentTextIcon, group: "Sales & Billing" },
  invoices: {
    icon: DocumentDuplicateIcon,
    route: "/invoices",
    group: "Sales & Billing",
  },
  "invoice-detail": {
    icon: DocumentDuplicateIcon,
    group: "Sales & Billing",
  },
  payments: {
    icon: CreditCardIcon,
    route: "/payments",
    group: "Sales & Billing",
  },
  technicians: {
    icon: WrenchScrewdriverIcon,
    route: "/technicians",
    group: "Team",
  },
  pricebook: {
    icon: BookOpenIcon,
    route: "/pricebook",
    group: "Catalog & Stock",
  },
  inventory: {
    icon: ArchiveBoxIcon,
    route: "/inventory",
    group: "Catalog & Stock",
  },
  suppliers: { icon: TruckIcon, route: "/suppliers", group: "Catalog & Stock" },
  purchasing: {
    icon: ShoppingCartIcon,
    route: "/purchasing",
    group: "Catalog & Stock",
  },
  serials: { icon: QrCodeIcon, route: "/serials", group: "Catalog & Stock" },
  equipment: {
    icon: CpuChipIcon,
    route: "/equipment",
    group: "Catalog & Stock",
  },
  agreements: {
    icon: ClipboardDocumentCheckIcon,
    route: "/agreements",
    group: "Agreements",
  },
  marketing: { icon: MegaphoneIcon, route: "/marketing", group: "Insights" },
  reports: { icon: ChartBarIcon, route: "/reports", group: "Insights" },
  settings: { icon: Cog6ToothIcon, route: "/settings", group: "Admin" },
  notifications: {
    icon: BellIcon,
    route: "/notifications",
    group: "Admin",
  },
};

const FALLBACK_META: PageHelpMeta = {
  icon: QuestionMarkCircleIcon,
  group: "Other",
};

export function getPageHelpMeta(key: string): PageHelpMeta {
  return META[key] ?? FALLBACK_META;
}

/** Every guide, in the order the Help Center should list them. */
export const pageHelpList: PageHelpContent[] = [
  dashboardHelp,
  myDayHelp,
  customersHelp,
  jobsHelp,
  jobDetailHelp,
  recurringHelp,
  dispatchHelp,
  mapHelp,
  estimatesHelp,
  estimateDetailHelp,
  invoicesHelp,
  invoiceDetailHelp,
  paymentsHelp,
  techniciansHelp,
  pricebookHelp,
  inventoryHelp,
  suppliersHelp,
  purchasingHelp,
  serialsHelp,
  equipmentHelp,
  agreementsHelp,
  marketingHelp,
  reportsHelp,
  settingsHelp,
  notificationsHelp,
];
