# PulseService — Trainer's Playbook

*Your companion for walking employees through PulseService — from the nervous "I'm not a computer person" folks to the power users who'll be running circles around the software by lunch.*

> **How to use this doc:** This isn't a script to read word-for-word — it's your cheat sheet. Skim the section you're about to teach, grab the talking points that fit the room, and lean on the "Trainer's tips" boxes to adjust for the crowd in front of you. Keep it open on a second monitor while you train.

---

## Table of Contents

1. [The Pitch (for the execs)](#1-the-pitch-for-the-execs)
2. [How to Run a Great Training Session](#2-how-to-run-a-great-training-session)
3. [The 10-Minute Foundation (everyone gets this)](#3-the-10-minute-foundation-everyone-gets-this)
4. [Role-Based Training Tracks](#4-role-based-training-tracks)
5. [Module-by-Module Walkthroughs](#5-module-by-module-walkthroughs)
6. [Teaching to Different Skill Levels](#6-teaching-to-different-skill-levels)
7. [The Golden Rules (drill these in)](#7-the-golden-rules-drill-these-in)
8. [Common "It's Broken!" Moments (and the real fix)](#8-common-its-broken-moments-and-the-real-fix)
9. [Quick Reference Card (print this for the team)](#9-quick-reference-card-print-this-for-the-team)

---

## 1. The Pitch (for the execs)

*Use this when you've got the leadership team in the room. Keep it high-level, tie everything back to money and time, and don't get lost in the buttons.*

### The one-liner

> **PulseService is our entire operation in one place** — from the first phone call with a customer to the final payment collected — so nothing falls through the cracks and everyone's working off the same information.

### The problem it solves

Right now (or in the old way of doing things), the business runs on a patchwork: a scheduling whiteboard, a spreadsheet for customers, a separate invoicing tool, sticky notes on trucks, and a lot of "let me call you back." Every handoff between those systems is a place where a job gets forgotten, an invoice never goes out, or a truck shows up without the right part.

PulseService closes those gaps. **One system, one source of truth, from lead to paid.**

### What it does, in exec terms

| Business function | What PulseService gives us |
| --- | --- |
| **Win the work** | A CRM that remembers every customer and their history, estimates you can send and get approved, and marketing/call tracking so we know which ads actually bring in calls. |
| **Do the work** | A drag-and-drop dispatch board, a live map of jobs, technicians' daily agendas on their phones, and full job records with photos, signatures, and time tracking. |
| **Get paid for the work** | Invoices that pull straight from completed jobs, payment recording, and an AR aging report so we stop leaving money on the table. |
| **Run the business** | Inventory and purchasing so trucks are stocked, service agreements for recurring revenue, and reports that tell us how each technician, customer, and campaign is actually performing. |

### The numbers that should matter to leadership

- **Faster cash flow.** Completed jobs turn into invoices in a couple of clicks — parts used are pulled in automatically. Less lag between finishing a job and billing for it.
- **Fewer dropped balls.** Every job has a status, every invoice has a balance, and the dashboard surfaces what's overdue. Nothing hides in someone's inbox.
- **Recurring revenue on autopilot.** Service agreements and recurring jobs generate the work automatically instead of relying on someone to remember.
- **Accountability and visibility.** Reports break down revenue, job completion rates, technician performance, and customer lifetime value. An activity log records who did what. We can manage by data, not gut feel.
- **It scales with us.** Role-based permissions mean a new hire only sees what they should, and the whole thing is built on the same feature set as the big-name platforms (think ServiceTitan) without the per-seat bill.

### The closing line

> "This isn't about adding software — it's about **removing the friction** between our people, our trucks, and our money. The team spends less time chasing information and more time doing billable work, and leadership finally gets to see the whole business on one screen."

> **Trainer's tip:** Execs care about outcomes, not clicks. If someone asks "but how does a technician actually clock in?" — that's your cue to say "great question, that's exactly what we cover in the hands-on session," and steer back to the business value. Save the buttons for the people who'll press them.

---

## 2. How to Run a Great Training Session

*Meta-advice for you, the trainer. This is the stuff that separates a session people remember from one they nap through.*

### Before you start

- **Have a demo account ready and warmed up.** Log in ahead of time so you're not fumbling with passwords in front of the room. Seeded logins live in the README (`admin@pulseservice.com` etc.).
- **Match the login to the audience.** Training dispatchers? Log in as the dispatcher account so they see exactly what they'll see — including which menu items are hidden from them. This is a huge "aha" moment (more on permissions below).
- **Know where you're pointing them.** Everyone trains and practices on the shared environment (see your team's deployment notes), *not* a developer's machine. Make sure the URL is written on the whiteboard.

### The rhythm that works

1. **Show, don't tell.** Do the action live first. Then narrate it. Then let *them* do it.
2. **One workflow at a time.** People don't remember features; they remember stories. "A customer calls → we find them → we book a job → we dispatch it → we bill it" sticks. A tour of 23 menu items does not.
3. **Let them break things.** They're on a training environment. Encourage clicking around. The person who's afraid to click is the person who'll be stuck at their desk next week.
4. **Repeat the golden rules** (Section 7) at natural moments, not all at once. Drop "remember, you can't edit an invoice once a payment's on it" *when* you're on the invoice screen.

### Reading the room

- **Eyes glazing?** You've been talking too long. Hand them the mouse.
- **Someone's way ahead?** Give them a "bonus challenge" (e.g., "set up a saved view for urgent jobs") while you help the others catch up.
- **Someone's frozen?** Sit next to them, not across. Narrate your own clicks slowly. Never grab their mouse — guide their hand.

> **Trainer's tip:** Your relaxed, jovial style is an asset here — lean into it. The single biggest barrier to software adoption is fear, and a laughing room is a fearless room. When something goes sideways in the demo (it will), joke about it and use it: "See? Even I clicked the wrong thing, and look — nothing exploded. You literally cannot break this."

---

## 3. The 10-Minute Foundation (everyone gets this)

*No matter their role, every employee needs these five things before anything else. Do this as a group, then split into role tracks.*

1. **Logging in.** The URL, their email, their password. Show them the login screen once. That's it.
2. **The layout.** Left sidebar = where you go. Top bar = search, notifications bell, and the **"?" help button**. Main area = where you work.
3. **The "?" button is your friend.** *Point this out early and often.* Every page has a built-in, plain-English guide behind the "?" in the top bar, and there's a full searchable **Help Center** too. Tell them: *"If I'm not standing next to you, that button is."*
4. **Clicking a row opens it.** Across Customers, Jobs, Estimates, and Invoices, clicking any row in a list opens its full detail page. Simple, consistent, everywhere.
5. **Their menu is their menu.** What they see in the sidebar depends on their role. If a coworker has a menu item they don't, that's on purpose — not a bug. (Great moment to introduce permissions.)

> **Trainer's tip:** Make them physically click the "?" button once during this intro. If they do it once with you, they'll do it alone later. A feature nobody discovers is a feature that doesn't exist.

---

## 4. Role-Based Training Tracks

*Don't teach everyone everything. Teach each person their job, plus enough of the neighbors' jobs to understand the handoffs. Here's who needs what.*

The app groups its features like this: **Overview · Customers & Jobs · Scheduling · Sales & Billing · Team · Catalog & Stock · Agreements · Insights · Admin.** Use these groups to decide what each role needs.

### CSR / Front Office (answers phones, books work)
**Core:** Dashboard, Customers, Jobs (creating them), Estimates, Marketing (logging calls).
**Why:** They're the front door. Their whole world is "find or create the customer, book the job, log the call."
**Skip for now:** Inventory, purchasing, reports, settings.

### Dispatcher (schedules and assigns)
**Core:** Dispatch Board (this is their home screen — spend the most time here), Jobs, Map, Technicians, Recurring Jobs.
**Why:** They own the calendar and the technicians' time.
**Skip for now:** Billing internals, catalog/stock management, settings.

### Technician (does the work in the field)
**Core:** My Day, Job Detail (clock in/out, notes, parts, photos, signature), Notifications.
**Why:** They live on a phone in a truck. Keep it to the two or three screens they'll actually touch.
**Skip entirely:** Reports, settings, purchasing — they won't see most of it anyway.

### Inventory / Purchasing (keeps trucks stocked)
**Core:** Inventory, Stock Locations, Cycle Count, Suppliers, Purchase Orders, Serialized Units.
**Why:** They own the parts pipeline from ordering to receiving to using.

### Manager / Ops (runs the day)
**Core:** A bit of everything, but especially Reports, Dispatch, Service Agreements, and the Activity Log.
**Why:** They need the bird's-eye view and the ability to spot problems.

### Admin / Exec (owns the system)
**Core:** Settings (Company, Billing, Users, Roles, Business Units), Reports, Activity Log.
**Why:** They configure the system, manage who can do what, and read the results.

> **Trainer's tip:** Do the group foundation together, then physically split the room into role pods if you can. A technician does not need to sit through a purchase-order lecture, and a dispatcher zoning out during an inventory deep-dive is a dispatcher you'll re-train next week. Respect their time and they'll respect the tool.

---

## 5. Module-by-Module Walkthroughs

*Your reference for each screen. Each entry has: what it's for, the workflow to demo, and the one thing people trip on. Teach the workflow, not the feature list.*

### Dashboard
- **What it is:** The home screen — today's jobs, unpaid invoices, this month's revenue, a 12-month trend chart, and recent activity.
- **Demo:** Point out the stat cards, click a recent job row to show it opens, then use a **Quick Action** button (New Job / New Customer / New Estimate / New Invoice) to jump straight into creating something.
- **They trip on:** Nothing, really — this is the safe, friendly starting point. Use it to build confidence.

### Customers (CRM)
- **What it is:** The master list of everyone you do business with, and a full detail page per customer showing their jobs, estimates, and invoices.
- **Demo:** Search for a customer → open their detail page → walk the Overview / Jobs / Estimates / Invoices tabs → click **New Job** from their page to show it's pre-linked to them.
- **Teach these tricks:**
  - **Residential vs. Commercial** tabs and colors (residential = blue, commercial = red).
  - **Saved Views** — set up a filtered/sorted list once, save it, reuse it forever.
  - **Import** for bulk-loading customers from a spreadsheet.
- **They trip on:** **Deleting a customer wipes all their jobs, estimates, invoices, and payments.** Say this out loud, twice. It's permanent.

### Jobs / Work Orders
- **What it is:** Every piece of work, from "New" through "Completed." The heart of the operation.
- **Demo:** Filter by status tabs → create a New Job (customer, type, priority, schedule, assign techs) → open a job's detail page.
- **On the Job Detail page, show:**
  - The **status timeline** and the **Update Status** button.
  - **Clock In / Clock Out** for time tracking.
  - **Materials & Equipment** — parts used and installed units.
  - **Signature** and **Photos & Attachments** for proof of work.
- **They trip on:** **Summary is required** (it's the short description shown everywhere). Also, **only one job can be clocked into at a time** — clock out of one before clocking into another.

### Recurring Jobs
- **What it is:** Templates that create jobs automatically on a schedule (weekly, monthly, quarterly, etc.).
- **Demo:** Create a schedule → show the **lightning-bolt** icon that generates a job on demand → show **Pause** and **Run due now**.
- **They trip on:** A **paused** schedule won't generate jobs even with "Run due now." Reactivate it first. Also: deleting a schedule doesn't delete jobs already created from it.

### Dispatch Board
- **What it is:** The drag-and-drop scheduling grid. The dispatcher's command center.
- **Demo (go slow, this is the star of the show for dispatchers):**
  - Switch **Day / Week / Month** views.
  - **Drag a job onto a technician's row** to assign it.
  - **Drag left/right** to change the time; drag to a different day in Week/Month.
  - **Unassigned panel** = has a date, no tech. **Undated panel** = has a tech (or neither), no date.
  - Click a job card to open the details panel and change status, assign, or edit schedule without leaving the board.
- **Teach these tricks:** The board is **live** — changes from other dispatchers appear automatically, no refresh. And if you drag something by mistake, it asks you to confirm before clearing a tech or date.
- **They trip on:** Confusing "Unassigned" with "Undated." Repeat the distinction until it sticks.

### Map
- **What it is:** A map of scheduled jobs over the next 14 days, for spotting clusters and planning routes.
- **Demo:** Click a pin → show the popup with job info and **Directions**.
- **They trip on:** A job only shows up if its address has been turned into coordinates. If something's missing, click **Geocode addresses**. Tell them to run it after adding new customers/sites.

### Estimates / Proposals
- **What it is:** Line-item quotes you send to customers, get approved, and convert to invoices.
- **Demo:** Create an estimate → **pick the customer first** (this unlocks linking to their job) → add line items → set discount and tax → save. Then on the detail page: **Send → Approve → Convert to Invoice**, and **PDF** to download.
- **They trip on:** Forgetting to pick the customer first, then wondering why they can't link a job.

### Invoices
- **What it is:** The bills. Created fresh or converted from an approved estimate.
- **Demo:** New Invoice → choose customer → **link to a completed job to pull in the parts used automatically** → add line items, discount, tax → save. Show balances in red (owed) vs. green (paid).
- **They trip on:** **You can only edit an invoice before a payment is recorded against it.** Once money's on it, it's locked. This is intentional — bookkeeping integrity.

### Invoice Detail & Payments
- **What it is:** Collecting and reviewing money.
- **Demo:** On an invoice: **Record Payment** (amount, method, reference like a check number). Show **Void** and the **Reverse** option next to a payment.
- **Teach the distinction:** **Reverse** a single payment if it was entered wrong; **Void** the whole invoice if it shouldn't be collected at all. On the Payments page, "reversed" = a bookkeeping correction (no money moved), "refunded" = an actual refund to the customer.
- **They trip on:** The Payments page is for *reviewing* payments, not creating them. New payments happen on the invoice itself.

### Technicians
- **What it is:** The team roster — skills, availability, contact info.
- **Demo:** Show a tech card, the Available/Busy badge, and the **Schedule** button that jumps to the dispatch board.
- **They trip on:** A new technician won't appear here until their **user account** (with the technician role) is created in Settings.

### Pricebook & Pricing Tiers
- **What it is:** Your catalog of services and parts with prices, plus discount tiers for special customers.
- **Demo:** Browse categories → add an item (SKU, name, cost, price, unit) → show **Import** for bulk loading. Then **Pricing Tiers** for customer-specific discounts and item overrides.
- **They trip on:** To give one customer a special price, you set up a pricing tier *and* assign it to that customer's profile — two steps.

### Inventory, Stock Locations & Cycle Count
- **What it is:** Everything in stock across the warehouse and trucks, with reorder alerts.
- **Demo:** Show low-stock highlighting and the banner → **Adjust** (add/remove/set) → **Transfer** (warehouse → truck) → the **history** clock icon → **Scan** a barcode → **Cycle Count** for a guided physical count.
- **They trip on:** "Serial" items are tracked individually (see Serialized Units). And cycle count posts the *variance* automatically — they enter what they physically counted, the system does the math.

### Suppliers & Purchase Orders
- **What it is:** Your vendors and the orders you place with them.
- **Demo:** Show suppliers list → create a PO (supplier, ship-to, line items) → mark **Ordered** → **Receive** items (quantity, location, serial numbers if prompted) and watch inventory update. Show **Reorder Suggestions** → "Create draft PO."
- **They trip on:** Receiving is what actually adds stock to inventory — a PO sitting in "Ordered" hasn't stocked anything yet.

### Serialized Units & Equipment
- **What it is:** Two different things — clarify this! **Serialized Units** = *your* uniquely-tracked stock (from received to installed). **Equipment** = the *customer's* installed gear (model, warranty, service history).
- **Demo:** Serialized Units — show a unit's status and the **Install** action. Equipment — show the warranty flags (Active / Expiring Soon / Expired) and service history.
- **They trip on:** Mixing up "our serial-tracked parts" with "the customer's equipment." Say it plainly: *"Serialized Units are ours until we install them. Equipment is theirs."*

### Service Agreements
- **What it is:** Recurring maintenance contracts — billing schedule + planned visits.
- **Demo:** Create an agreement (customer, plan, billing frequency, dates) → open it → schedule a **visit** → mark a visit complete with the checkmark.
- **They trip on:** Confusing agreements (contracts) with recurring jobs (auto-generated work orders). Related, but different tools.

### Marketing (Campaigns, Calls, Messages)
- **What it is:** Tracking what marketing brings in, and logging every customer call/message.
- **Demo:** Create a campaign with a **tracking number** → log a call and link it to that campaign → log a message.
- **They trip on:** Nothing major. Emphasize the payoff: link calls to campaigns and you can finally prove which ads work.

### Reports
- **What it is:** The scoreboard — Revenue, Sales, Estimates, Jobs, Technicians, Customers, AR Aging, Inventory, each on its own tab.
- **Demo:** Walk the tabs. Highlight **AR Aging** (who owes you and how overdue) for managers.
- **They trip on:** Forgetting the date/month selectors on Revenue and Sales change what they're looking at.

### Settings (Admin)
- **What it is:** Account, Company, Billing, Users, Roles, Business Units, Activity Log, QuickBooks. **Tabs shown depend on permissions.**
- **Demo (admin audience):** Update the company profile → invite a user and assign a role → open **Roles** and toggle a permission → show the **Activity Log**.
- **They trip on:** Not realizing that changing a role's permissions instantly changes what every user with that role can see and do.

### My Day (technicians)
- **What it is:** The technician's phone agenda — today's jobs in order, with Navigate and Call buttons.
- **Demo (ideally on an actual phone):** Show the day's list, the day arrows, tapping a job to open it, **Navigate** for directions, **Call** to dial the customer.
- **They trip on:** Empty list = no jobs assigned/scheduled for that day. That's a dispatch issue, not a broken app.

### Notifications
- **What it is:** In-app alerts about jobs, invoices, estimates — plus optional push to your phone.
- **Demo:** Show the bell, open the Notifications page, **Mark all read**, and the push-notification banner if the device supports it.
- **They trip on:** Push only works on supported devices and needs the banner opt-in. If they don't see the toggle, it's just not available on that device — not broken.

---

## 6. Teaching to Different Skill Levels

*The same feature, explained three ways. Read the person, pick the register.*

### The Nervous Beginner ("I'm not good with computers")
- **Anchor everything to what they already do.** "This is just your customer binder, but you can search it." "This is the whiteboard, but it can't get erased by accident."
- **One click at a time. Full stop after each.** Let them press the button, see the result, and breathe.
- **Reassure them constantly that they can't break it.** They're on a training environment. Repeat it.
- **Give them a single happy path to memorize**, not options. "To book a job: click here, here, here, done." Fancy stuff comes later.
- **Celebrate the small wins.** The first time they create a customer solo, make a genuine deal out of it.

### The Comfortable Middle ("I use apps fine, just show me")
- **Teach the workflow, not the buttons.** They'll find the buttons. Give them the sequence: quote → approve → invoice → collect.
- **Introduce the time-savers:** Saved Views, keyboard-free row-clicking, quick actions from the dashboard, converting estimates straight to invoices.
- **Point them at the "?" help** and turn them loose. They learn by poking.

### The Power User ("I could've built this")
- **Give them the *why* and the edge cases.** Why can't you edit a paid invoice? Because bookkeeping integrity — reverse the payment instead. They love the reasoning.
- **Show off the deep features:** pricing tier item-overrides, cycle-count variance posting, reorder suggestions, permission mapping, CSV import/export.
- **Recruit them.** Power users become your floor-level support. Make them feel like insiders and they'll train their neighbors for you.

> **Trainer's tip:** Never use the same explanation for all three. The beginner needs safety, the middle needs the recipe, the power user needs the reasoning. Misjudge it and you either terrify the beginner or bore the expert. When in doubt, start simple — it's easy to add depth, hard to un-scare someone.

---

## 7. The Golden Rules (drill these in)

*The handful of things that, if everyone remembers them, prevent 90% of the "help!" calls. Repeat them in context, not as a list.*

1. **Clicking a row opens it.** Everywhere. Customers, jobs, estimates, invoices.
2. **The "?" button and Help Center answer most questions** before you need a human.
3. **You can't edit an invoice once a payment is on it.** To fix a mistake, reverse the payment first.
4. **Reverse a payment ≠ Void an invoice.** Reverse fixes one wrong payment; void kills the whole bill.
5. **Deleting a customer deletes everything attached to them.** Permanently. Archive instead when unsure.
6. **Pick the customer first** on estimates and invoices — it unlocks linking their jobs and pulling in parts.
7. **Only one job clocked in at a time.** Clock out before clocking into the next.
8. **Unassigned = has a date, needs a tech. Undated = has a tech, needs a date.**
9. **A paused recurring schedule won't generate jobs.** Reactivate it first.
10. **Your menu differs from your coworker's on purpose** — that's permissions, not a bug.

> **Trainer's tip:** Print these ten as a one-pager and tape it near everyone's desk for the first two weeks. Muscle memory beats memory.

---

## 8. Common "It's Broken!" Moments (and the real fix)

*Nine times out of ten, "it's broken" means "I expected something different." Here's the reality behind the usual panic. This section is mostly for you and your admins.*

| The complaint | What's actually happening | The fix |
| --- | --- | --- |
| "The new feature isn't here!" | The shared environment hasn't been updated/pulled with the latest code yet, or the browser tab is stale. | Confirm the environment was rebuilt; then **hard refresh** (Ctrl + Shift + R). |
| "A dropdown option is missing." | New option was added but the environment needs a rebuild to sync it. | Rebuild syncs new dropdown options automatically — no data wipe needed. |
| "I can't edit this invoice." | A payment has been recorded against it. | That's intended. Reverse the payment first, or void and reissue. |
| "This job won't show on the map." | Its address hasn't been geocoded. | Click **Geocode addresses**; double-check the address is filled in. |
| "A number field keeps snapping back to 0 / won't clear." | Older raw input behavior. | Should be resolved with the current build; report it if it persists. |
| "My Day is empty." | No jobs assigned/scheduled for that tech that day. | It's a dispatch/scheduling gap, not a bug. |
| "A page says 'Failed to fetch dynamically imported module.'" | Stale code chunk after an update. | Hard refresh; the app usually auto-reloads. If stuck, unregister the service worker once. |
| "I don't have the menu item my coworker has." | Role permissions. | Working as intended. An admin can adjust the role in Settings → Roles if appropriate. |

> **Trainer's tip:** Teach your managers and admins this table specifically. When the team can self-diagnose "oh, I just need a hard refresh," your support load drops off a cliff. The magic words to spread: **"Try a hard refresh first."**

---

## 9. Quick Reference Card (print this for the team)

*One page. Hand it out. This is the "I forgot what you said" safety net.*

**Getting around**
- Left sidebar = navigate. Top bar = search, notifications 🔔, and **Help "?"**.
- **Click any row** to open its full detail.
- Stuck? Hit the **"?"** on any page, or open the **Help Center**.

**Book & do the work**
- New customer: **Customers → New Customer** (or the dashboard Quick Action).
- New job: **Jobs → New Job**, or **New Job** from a customer's page (auto-links them).
- Schedule it: **Dispatch Board** — drag the job onto a technician's row.
- In the field: **My Day** on your phone → tap a job → **Navigate** / **Call** / clock in.

**Get paid**
- Quote: **Estimates → New Estimate** (pick the customer first!) → Send → Approve → **Convert to Invoice**.
- Bill: **Invoices → New Invoice**, link the completed job to pull in parts.
- Collect: open the invoice → **Record Payment**.

**Remember**
- Can't edit a paid invoice — **reverse the payment** first.
- **Deleting a customer deletes everything of theirs** — archive if unsure.
- One job clocked in at a time.
- Something missing after an update? **Hard refresh (Ctrl + Shift + R).**

---

*That's the playbook. Keep it relaxed, keep them clicking, and remember: the goal isn't to make everyone an expert on day one — it's to make everyone unafraid to explore. The rest takes care of itself.*
