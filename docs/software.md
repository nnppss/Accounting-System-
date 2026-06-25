# Paritosh Cold — Software Specification

A personal accounting software for **Paritosh Cold Storage** (a potato cold storage). Single user (the owner), runs on one Windows laptop, offline. It manages every rupee (Cr/Dr) between the cold storage and the parties it deals with, plus the physical stock of potato packets. The whole app is **bilingual — English and Hindi**, switchable live.

This describes the software *as built* (all planned modules ship; automated file backups and the optional AI chatbot remain the only unbuilt items). See [architecture.md](architecture.md) for *how* it's built.

---

## 1. The business it models

**What a cold storage does:** farmers (*kisan*) bring harvested potatoes to store them safely. They pay **rent per packet** (*bhada*) and may take **loans** from the cold. Later a kisan sells his stored potatoes to a trader (*vyapari*). The kisan–vyapari price is their private deal — the cold isn't part of it — but the **vyapari pays the cold storage** (cash or cheque), and the cold then **settles the kisan's account**.

**Parties**
- **Owner** — Paritosh Cold Storage (the software's only user). All Cr/Dr is from the cold's point of view.
- **Kisan** (farmer) — stores packets, pays rent, may take loans, sells to vyaparis.
- **Vyapari** (trader) — buys a kisan's potatoes, pays the cold.
- Plus **Staff**, **Loading Contractors**, and **Others** (suppliers, banks, capital, income heads, etc.).

**The year & carry-forward.** An accounting year runs **1 Jan – 31 Dec**. Unpaid balances **carry forward** as next year's opening balance. **Only money carries forward — physical stock does not:** leftover packets on 31 Dec are disposed and the store is prepped fresh, so stock starts empty each year.

**The settlement rule.** When a vyapari pays the cold for a kisan's potatoes: **(1) rent is deducted first**, then **(2)** the remainder is split at the kisan's choice between **cash paid out to him** and **loan repayment**.
> Example: loan ₹2,00,000, rent ₹50,000, sale ₹1,50,000 → ₹50k clears rent, kisan takes ₹50k cash, ₹50k pays down the loan → loan remaining ₹1,50,000.

---

## 2. How the software is organised

Three kinds of modules sit on **one double-entry ledger**:

- **Masters** — Account Manager + People (every party + the cold's own accounts).
- **Operations** — Aamad, Sauda, Nikasi, Bhada, Loans, Cheques, Bardana, Expenses, Vouchers (these record real events and post Cr/Dr).
- **Views** — Maps, Money Book, Trial Balance, Bills & Salaries, Party, Audit (these only read and present).

Underneath them is the **Accounting Engine** (vouchers + ledger) and the **Year-end Close**. Everything is reachable from a single left-nav shell (20 pages), behind a login gate.

---

## 3. Modules

### 3.1 Account Manager
Creates and manages the accounts of every party and the cold's own books, and shows each account's full ledger.

**To create an account:** pick an **Account Type** → fill details → assign a **Subgroup**. Every account gets a human-facing **account number** (e.g. `K-26-0001` = type prefix · 2-digit year · per-type serial), distinct from its internal id.

**Account types & fields** (common fields: Name, Son of, Village/City, State, Phone):
- **Kisan**, **Vyapari** — the common fields.
- **Staff** — common + **Job**; staff accounts track salaries.
- **Loading Contractor** — common + **loading charge (year)**, **unloading charge (year)**, **labourers brought in during loading season**, **and during unloading season**.
- **Bank** — one per real bank account (HDFC, Canara, Canara Current, …); fields **Account number**, **IFSC code**, **Branch** instead of the person fields. The **Subgroup is pinned to *Cash and Bank*** (locked at creation), so every bank automatically gets its own book in the Money Book.
- **Other** — for the remaining non-person accounts (capital, rent income, suppliers, etc.); person fields left blank.
- **Defaulter** — *not a type but a flag.* A Defaulter Kisan / Defaulter Vyapari **keeps their normal account and also appears in the Defaulters view**. Set **manually** (pre-existing defaulters at setup) or **automatically** at year-end.

**Subgroups** (9 fixed accounting groups, free choice of any type): Capital Account · Cash and Bank · Direct Expense · Farmer · Sundry Creditors · Sundry Debtors · Secured Loans · Revenue Account · Income from Other Resource.

**The cold's own books** are pre-seeded system accounts: Cash, Capital, Rent/Bhada Income, Interest Income, Bardana Sales, Bardana Purchase, Salary Expense, Loading Expense, Opening Balance Equity, and Cheques in Clearing. (Banks aren't seeded — you create one **Bank**-type account per real bank.)

**Account page & search** — filter accounts by type/subgroup/search; open any account to view its identity (editable), its **ledger**, opening balance, and defaulter flag. Accounts can be deleted (password-gated, audited) when they carry no ledger history.

**Opening balances** are carried from last year's closing (bilateral — we owe them, or they owe us).

### 3.2 People
A real human can hold several role-accounts (e.g. both a kisan and a vyapari). The **People page** manages explicit Person records and a **type-ahead picker links accounts to a person**; son-of / village / phone are only hints to suggest a match — the software never auto-merges two parties on name alone.

### 3.3 Aamad (Stock-in / intake)
The inward intake of packets during the filling season.
- **Header:** Aamad no., Date, Kisan, Total packets.
- **Location lines:** each line = **Room → Floor → Rack** + packets stored there.
- One **kisan → many aamads** (each turn = a new aamad no.). One **aamad → many locations**.
- **Aamad no.** is a serial allotted at the gate on a physical slip; the accountant types the serial and the system composes it with the working year as `YYYY-serial` (unique per year, effectively resetting to 1 each year).
- **Store layout** is Room → Floor → Rack, built to scale to **8 rooms × 10 floors × 200 racks** (currently 5 × 6 × 160; editable on the Store page).
- **Search** by date / date-range or by kisan → shows the matching aamads with **count of aamads (turns)** and **total packets**.
- Aamad is **physical only — it posts nothing**. Aamads can be deleted (audited).

### 3.4 Maps (three stock grids)
A visual Rooms × Floors grid of where packets are, with drill-down. **Three maps**, all the same grid:
- **Aamad (Stock-in)** — packets brought in.
- **Nikasi (Stock-out)** — packets that left (each carries a gate-pass number).
- **Current Stock** — what's physically there now = **Aamad − Nikasi**.

Each **cell = total packets** at that room+floor; a **Totals row** sums each room. **Click a cell → its racks; click a rack → a popup** of whose packets are there (a rack can hold several kisans'):
- Aamad / Current Stock popup: **kisan + packets + aamad no.**
- Nikasi popup: **kisan + vyapari + packets + gate pass.**

The maps start **empty each new year**.

### 3.5 Sauda (Deals)
A record of the private kisan↔vyapari deal — kept because its **rate drives the Nikasi**.
- **Fields:** Date, Vyapari, Kisan, packets, rate (per packet).
- A vyapari deals with **many kisans**, and the **rate can differ per kisan**. The latest agreed rate per (vyapari, kisan) auto-fills the Nikasi.
- Sauda and Nikasi hold the **same information**; whichever you have time for is filled first (a quick sale goes straight to Nikasi; a deal arranged in advance is recorded as a Sauda).
- Sauda is **physical only — it posts nothing**.

### 3.6 Nikasi (Stock-out / gate pass)
The gate pass for packets physically leaving.
- **Header:** Bill no. (= gate-pass no., auto-serial, resets yearly), Date, Vehicle no., **Delivered to** (a Kisan or a Vyapari), **Bhada recovered**, and **who actually received** delivery (may be the kisan's relative/son).
- **Lines (per kisan whose packets go out):** from-kisan, Room/Floor/Rack, packets, **weight**, **rate per packet**.
- **Delivered to a vyapari** = a sale: he can buy from **several kisans the same day**; **amount = packets × rate** (rate from the deal; weight is recorded only, not used for pricing).
- **Delivered to the kisan himself** = self-withdrawal: no money, just packets out.
- A vyapari Nikasi **auto-posts** its ledger entries (vyapari owes / kisan credited, plus the agreed bhada recovery), all editable. The gate pass can be **printed to PDF**.

### 3.7 Bhada (Rent)
The storage rent owed by a kisan — **per packet**, at a **flat yearly rate set at the start of the year**.
- Quality, grade, location and **duration don't matter**: any packet brought in is charged the full year's rent (no minimum/maximum, no proration).
- **A kisan owes the full rent no matter what** = total packets stored × rate (e.g. 100 packets @ ₹10 = ₹1000), even on packets never withdrawn.
- It's **recovered piecemeal across his Nikasis** at amounts **agreed with him each time** (not packets-in-that-nikasi × rate). The unrecovered part is his **standing bhada**.
> ₹1000 total; first nikasi worth ₹400 → recover an agreed ₹200 → standing bhada ₹800, recovered later.
- The charge is posted (Dr Kisan / Cr Rent Income) once the stored quantity is known; an `accrue all` charges every kisan for the year.
- Unpaid bhada at year-end → carries into next year's opening balance, the kisan becomes a **Defaulter**, and the amount becomes an **indirect loan** (interest from 1 Jan).

### 3.8 Loans (Udhaar)
Loans the cold gives, in three categories: **Kisan / Vyapari / Others**.
- **Fields:** Date, Amount, Mobile, **Loan type** (a single Cash-or-Bank choice; bank picks the bank account), **Direct / Indirect**, monthly rate (default editable), Remark.
- **Interest:** **simple in the first year, then compound** thereafter; default **1.5% per month** (= 150 bps, editable per loan); **capitalised every 1 Jan**.
  > ₹1,00,000 on 1 Jan 2026, unpaid through the year → on 1 Jan 2027 the principal becomes ₹1,18,000 (12 × 1.5% = ₹18,000 added); then 1.5%/month runs on ₹1,18,000.
- **Direct** loan — the party directly asks; created manually; **interest from the day sanctioned**; disbursement posts Dr Party / Cr Cash-or-Bank.
- **Indirect** loan — arises from **unpaid dues**; created manually **or auto-generated** at year-end; interest-free in the year incurred, then from **1 Jan** next year (no cash moves at creation).
- A party can hold **multiple loans**; each shows in the party's ledger with its live outstanding (principal + accrued interest).
- **Part payment** is deducted from the outstanding total (principal + interest to that day); the remainder carries on accruing. The page also shows each loan's composition and supports per-loan / all-loan capitalisation.

### 3.9 Cheques
Cash and **cheque** only. A cheque records **no., bank, direction (received/given), amount, date, issue date, clearance date**.
- A cheque sits in a **Cheques-in-Clearing** holding account and only **hits the bank on its clearance date** — so bank and Money-Book balances always show **cleared money only**.
- Lifecycle: **record → clear** (moves to the bank) **or bounce** (reverses). The page lists cheques by status and shows pending received/given totals.

### 3.10 Bardana
The bags/sacks potatoes are filled into — bought and sold by the cold. **Independent of the stored packets** (a kisan buying bags is unrelated to the packets he brings).
- **Bardana Purchase** (we buy) and **Bardana Issue** (we sell), same fields: Date, Name (a ledger account), Rate, Quantity (pcs), **Amount = Rate × Quantity** (auto), payment mode (cash / which bank).
- **Flexible settlement:** the amount can be **paid in full, paid partly, or left fully on credit** — whatever isn't paid is carried on the named party's own ledger (tag `trade`), exactly like a Nikasi sale. A party is required whenever anything is left unpaid.
- **Bardana A/C** shows two lists (purchases / issues), each with a total; the **bardana stock count** (purchased − issued, pieces); and **profit = total sales − total purchases**.

### 3.11 Expenses (Staff & Loading)
The cold's own operating outflows.
- **Salaries** — pay a staff member; the **salary register** lists payments.
- **Loading/Unloading** — pay a loading contractor against their per-year loading/unloading charges and labourer counts (configurable per contractor per year); the **loading register** lists payments.
- Both post Dr Expense / Cr Cash-or-Bank.

### 3.12 Accounting Engine — Vouchers & Ledger
The money backbone — how every Cr/Dr is recorded.
- **Voucher types:** **Receipt** (money in), **Payment** (money out), **Journal** (rent charge, adjustments, opening balances), **Contra** (cash↔bank / bank↔bank). Entries are **auto-filled but editable**. Every voucher must balance (Σ Dr = Σ Cr) or it is refused.
- **Vouchers page** lists/filters vouchers and shows each voucher's detail; vouchers are **voided/reversed, never deleted**.
- **Trial Balance** proves the books tie (Σ debits = Σ credits) and is printable.
- When a payment settles several things (rent / loan / cash), the split is **decided manually** with the party.

### 3.13 Money Book (cash & bank book)
The cold's pure money in/out record.
- Sections: **Cash** and **each Bank**. Select one to see its book.
- Month-wise: **month | opening | receipts | payments | balance** (balance carries into next month).
- **Click a month** → every transaction (date, party, particulars, receipt/payment, running balance, cheque no.).
- Transfers appear as a **payment in one book and a receipt in the other**; cheques appear only when **cleared**.

### 3.14 Bills & Salaries
A **person-wise, record-to-date statement** of all dealings between a party and the cold — for clear records. The page has a **Bill / Salary toggle**, because staff don't carry bills, they carry **salary slips**:
- **Bill** — every party with ledger dealings (kisan / vyapari / loading contractor / other). **One bill per person, with a section per role**, each showing that role's details and balance, plus a **single combined net**. The list's value column is the **Net** balance.
- **Salary** — staff accounts. Salary is paid (cash or bank) against the Salary Expense head, not the staff member's own ledger, so their Net is always nil; the list's value column instead shows **Salary paid** (their year's total from the salary register). A person who is *both* staff and a trading party appears under both tabs.
- The chosen tab and search **persist** when you open a slip and come back (like the Accounts list keeps its filters).
- **Continuous** — viewable/printable any day (as-of date), reflecting state as of that date.
- A **printout/record only — the ledger is the source of truth** (it computes live figures like loan interest, but posts nothing). Printable to PDF.
- Same-person disambiguation by **father's name / village-city / phone**.

### 3.15 Party (filter search & insights)
A query tool over **every party** — stack filters (combined with **AND**; numbers support **= / ≤ / ≥ / between**) to answer questions across the whole app.
- Filter by **identity** (type, subgroup, village, phone, defaulter, multi-role), **stock** (packets brought, aamads, current stock, location), **sales** (packets sold, to/from a party), **balance** (owes us / we owe, amount, aging), **rent** (standing bhada), **loans** (outstanding, type, overdue), **bardana**, and **activity**.
  > e.g. "kisans who brought ≤ 500 packets and still owe > ₹10,000".
- Results list shows name · son-of · village · phone · role · balance + the filtered metric, with count + totals; **saved presets**; each row clicks through to that party's Bill / ledger.

### 3.16 Audit Trail
Every create / edit / void is logged with **what changed (before/after), who (the session accountant), and when**. The **Audit page** filters and facets the log. Nothing is hard-deleted (only voided/reversed).

### 3.17 Year-end Close
A **dedicated, password-gated** feature that closes the year in **one button**, in order:
1. **capitalise** loan interest,
2. carry each balance forward as next year's opening (including cash/bank),
3. convert unpaid dues into **indirect loans** (interest from 1 Jan),
4. **flag defaulters** (parties only — not banks),
5. **reset the stock maps** (leftover packets disposed).

It shows a **summary** (accounts carried forward, total dues, new defaulters, indirect loans + total, interest capitalised, maps cleared) and an **exceptions list** (odd balances, pending cheques, inconsistencies). It's **reversible** via a recorded rollback plan ("undo close") and saves a closing report.

---

## 4. How it all works together

**Filling season:** a kisan brings potatoes → **Aamad** records the packets and their racks → they appear on the **Aamad** and **Current Stock** maps → his **rent** for the year is now owed (full stored × rate).

**Selling:** the kisan agrees a price with a vyapari → recorded as a **Sauda** (or straight to Nikasi) → packets leave on a **Nikasi** gate pass → the maps update (Nikasi up, Current Stock down) → the Nikasi posts **vyapari owes / kisan credited**, and recovers an agreed slice of **bhada**.

**Money:** the vyapari pays the cold (**Receipt**; a cheque clears later) → the cold settles the kisan — **rent first**, then loan repayment and/or **cash paid out** (**Payment**) per his choice. All of this flows through the **Money Book** (cash/bank) and each party's **ledger** and **Bill**.

**Loans** run alongside, accruing interest. **Bardana** is a separate buy/sell sub-ledger; **Expenses** (salary, loading) are the cold's outflows.

**Year-end:** whatever is unpaid becomes the party's **opening balance**, a **defaulter** flag, and an **indirect loan**; physical stock is wiped; the new year starts clean.

---

## 5. Login, users, safety
- **Login asks: year · username · password · accountant.** The *year* sets the working accounting year; *username/password* authenticate; the *accountant* name is stamped on every entry (held in the session). On first run a default admin + the current year are created so there's no lockout.
- **Audit trail** — every create / edit / void is logged with who and when; nothing is hard-deleted (only voided/reversed).
- **Bilingual** — the entire UI switches live between English and Hindi.
- **Backups (planned)** — the whole database is one file; the design copies it on open/close and snapshots before a year-end close. The close already records a logical rollback plan; **file-level automatic backups are not yet wired.**
- **AI assistant (planned)** — a future chatbot will answer questions by querying the read-only views; it never posts. Not built.
