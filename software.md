# Paritosh Cold — Software Specification

A personal accounting software for **Paritosh Cold Storage** (a potato cold storage). Single user (the owner), runs on one Windows laptop, offline. It manages every rupee (Cr/Dr) between the cold storage and the parties it deals with, plus the physical stock of potato packets.

---

## 1. The business it models

**What a cold storage does:** farmers (*kisan*) bring harvested potatoes to store them safely. They pay **rent per packet** (*bhada*) and may take **loans** from the cold. Later a kisan sells his stored potatoes to a trader (*vyapari*). The kisan–vyapari price is their private deal — the cold isn't part of it — but the **vyapari pays the cold storage** (cash or cheque), and the cold then **settles the kisan's account**.

**Parties**
- **Owner** — Paritosh Cold Storage (the software's only user). All Cr/Dr is from the cold's point of view.
- **Kisan** (farmer) — stores packets, pays rent, may take loans, sells to vyaparis.
- **Vyapari** (trader) — buys a kisan's potatoes, pays the cold.
- Plus **Staff**, **Loading Contractors**, and **Others** (suppliers, banks, etc.).

**The year & carry-forward.** An accounting year runs **1 Jan – 31 Dec**. Unpaid balances **carry forward** as next year's opening balance. **Only money carries forward — physical stock does not:** leftover packets on 31 Dec are disposed and the store is prepped fresh, so stock starts empty each year.

**The settlement rule.** When a vyapari pays the cold for a kisan's potatoes: **(1) rent is deducted first**, then **(2)** the remainder is split at the kisan's choice between **cash paid out to him** and **loan repayment**.
> Example: loan ₹2,00,000, rent ₹50,000, sale ₹1,50,000 → ₹50k clears rent, kisan takes ₹50k cash, ₹50k pays down the loan → loan remaining ₹1,50,000.

---

## 2. How the software is organised

Three kinds of modules sit on **one double-entry ledger**:

- **Masters** — Account Manager (every party + the cold's own accounts).
- **Operations** — Aamad, Sauda, Nikasi, Bhada, Bardana, Loans (these record real events and post Cr/Dr).
- **Views** — Map, Money Book, Bills, Party (these only read and present).

Underneath them is the **Accounting Engine** (vouchers + ledger) and the **Year-end Close**.

---

## 3. Modules

### 3.1 Account Manager
Creates and manages the accounts of every party and the cold's own books, and shows each account's full ledger.

**To create an account:** pick an **Account Type** → fill details → assign a **Subgroup**.

**Account types & fields** (common fields: Name, Son of, Village/City, State, Phone):
- **Kisan**, **Vyapari** — the common fields.
- **Staff** — common + **Job**; staff accounts track salaries.
- **Loading Contractor** — common + **loading charge (year)**, **unloading charge (year)**, **labourers brought in during loading season**, **and during unloading season**.
- **Other** — for all non-person accounts (cash, each bank, capital, rent income, etc.); person fields left blank.
- **Defaulter Kisan / Defaulter Vyapari** — a party who failed to clear their balance. A defaulter **keeps their normal account and also appears in the Defaulters list** — it's a flag/view, not a separate ledger. Set **manually** (for pre-existing defaulters at setup) or **automatically** at year-end.

**Subgroups** (the accounting group each account rolls into, free choice of any type): Capital Account · Cash and Bank · Direct Expense · Farmer · Sundry Creditors · Sundry Debtors · Secured Loans · Revenue Account · Income from Other Resource.

**Person link.** One real human can hold several role-accounts (e.g. both a kisan and a vyapari). An **explicit Person record links them**; son-of / village / phone are only hints to suggest a match — the software never auto-merges two parties on name alone.

**Opening balances** are carried from last year's closing (bilateral — we owe them, or they owe us).

### 3.2 Aamad (Stock-in / intake)
The inward intake of packets during the filling season.
- **Header:** Aamad no., Date, Kisan, Total packets.
- **Location lines:** each line = **Room → Floor → Rack** + packets stored there.
- One **kisan → many aamads** (he brings his harvest in turns; each turn = a new aamad no.). One **aamad → many locations**.
- **Aamad no.** is a serial **issued by management staff on a physical slip** (the accountant types it in); it **resets to 1 every year**.
- **Store layout** is Room → Floor → Rack, built to scale to **8 rooms × 10 floors × 200 racks** (currently 5 × 6 × 160).
- **Search** by date / date-range or by kisan → shows the matching aamads with **count of aamads (turns)** and **total packets**.

### 3.3 Map (three stock grids)
A visual Rooms × Floors grid of where packets are, with drill-down. **Three maps**, all the same grid:
- **Aamad (Stock-in)** — packets brought in.
- **Nikasi (Stock-out)** — packets that left (each carries a gate-pass number).
- **Current Stock** — what's physically there now = **Aamad − Nikasi**.

Each **cell = total packets** at that room+floor; a **Totals row** sums each room. **Click a cell → its racks; click a rack → a popup** of whose packets are there (a rack can hold several kisans'):
- Aamad / Current Stock popup: **kisan + packets + aamad no.**
- Nikasi popup: **kisan + vyapari + packets + gate pass.**

The maps start **empty each new year**.

### 3.4 Sauda (Deals)
A record of the private kisan↔vyapari deal — kept because its **rate drives the Nikasi**.
- **Fields:** Date, Vyapari, Kisan, packets, rate (per packet).
- A vyapari deals with **many kisans**, and the **rate can differ per kisan**.
- Sauda and Nikasi hold the **same information**; whichever you have time for is filled first (a quick sale goes straight to Nikasi; a deal arranged in advance is recorded as a Sauda).

### 3.5 Nikasi (Stock-out / gate pass)
The gate pass for packets physically leaving.
- **Header:** Bill no. (= gate-pass no., staff-issued slip, resets yearly), Date, Vehicle no., **Delivered to** (a Kisan or a Vyapari), **Bhada (rent)**, and **who actually received** delivery (may be the kisan's relative/son).
- **Lines (per kisan whose packets go out):** from-kisan, Room/Floor/Rack, packets, **weight**, **rate per packet**.
- **Delivered to a vyapari** = a sale: he can buy from **several kisans the same day**; **amount = packets × rate** (rate from the deal; weight is recorded only, not used for pricing).
- **Delivered to the kisan himself** = self-withdrawal: no money, just packets out.
- A Nikasi **auto-posts** its ledger entries (vyapari owes / kisan credited + the bhada), all editable.

### 3.6 Bhada (Rent)
The storage rent owed by a kisan — **per packet**, at a **flat yearly rate set at the start of the year**.
- Quality, grade, location and **duration don't matter**: any packet brought in is charged the full year's rent (no minimum/maximum, no proration).
- **A kisan owes the full rent no matter what** = total packets stored × rate (e.g. 100 packets @ ₹10 = ₹1000), even on packets never withdrawn.
- It's **recovered piecemeal across his Nikasis** at amounts **agreed with him each time** (not packets-in-that-nikasi × rate). The unrecovered part is his **standing bhada**.
> ₹1000 total; first nikasi worth ₹400 → recover an agreed ₹200 → standing bhada ₹800, recovered later.
- Unpaid bhada at year-end → carries into next year's opening balance, the kisan becomes a **Defaulter**, and the amount becomes an **indirect loan** (interest from 1 Jan).
- A rare **discount** provision exists (on the full amount or the per-packet rate).

### 3.7 Bardana
The bags/sacks potatoes are filled into — bought and sold by the cold. **Independent of the stored packets** (a kisan buying bags is unrelated to the packets he brings).
- **Bardana Issue** (we sell) and **Bardana Purchase** (we buy), same fields: Date, Name (a ledger account), Rate, Quantity (pcs), **Amount = Rate × Quantity** (auto), payment mode (cash / which bank).
- **Bardana A/C** shows two lists (purchases / sales), each with a total; the **bardana stock count** (purchased − issued); and **profit = total sales − total purchases**.

### 3.8 Loans (Udhaar)
Loans the cold gives, in three categories: **Kisan / Vyapari / Others**.
- **Fields:** Date, Amount, Mobile, **Loan type** (a single Cash-or-Bank choice), **Direct / Indirect**, Remark.
- **Interest:** **simple in the first year, then compound** thereafter; default **1.5% per month** (editable); **capitalised every 1 Jan**.
  > ₹1,00,000 on 1 Jan 2026, unpaid through the year → on 1 Jan 2027 the principal becomes ₹1,18,000 (12 × 1.5% = ₹18,000 added); then 1.5%/month runs on ₹1,18,000.
- **Direct** loan — the party directly asks; created manually; interest from the day sanctioned.
- **Indirect** loan — arises from **unpaid dues**; created manually **or auto-generated** at year-end; interest-free in the year incurred, then from **1 Jan** next year.
- A party can hold **multiple loans**; they show in the party's ledger.
- **Part payment** is deducted from the outstanding total (principal + interest to that day); the remainder carries on accruing.

### 3.9 Accounting Engine (vouchers & ledger)
The money backbone — how every Cr/Dr is recorded.
- **Voucher types:** **Receipt** (money in), **Payment** (money out), **Journal** (rent charge, adjustments, opening balances), **Contra** (cash↔bank / bank↔bank). Entries are **auto-filled but editable**.
- **Trial Balance** proves the books tie (Σ debits = Σ credits).
- **Cash and cheque only.** A cheque records **no., bank, date, issue date, clearance date** and only **hits the bank on its clearance date** (for cheques received and given).
- When a payment settles several things (rent / loan / cash), the split is **decided manually** with the party.

### 3.10 Money Book (cash & bank book)
The cold's pure money in/out record.
- Sections: **Cash** and **each Bank**. Select one to see its book.
- Month-wise: **month | opening | receipts | payments | balance** (balance carries into next month).
- **Click a month** → every transaction (date, party, particulars, receipt/payment, running balance, cheque no.).
- Transfers appear as a **payment in one book and a receipt in the other**; cheques appear only when **cleared**.

### 3.11 Bills
A **person-wise, record-to-date statement** of all transactions between a party and the cold — for clear records.
- **One bill per person, with a section per role** (kisan / vyapari / staff / contractor / other), each showing that role's details and balance, plus a **single combined net** at the bottom.
- **Continuous** — viewable/printable any day, reflecting state as of that date.
- A **printout/record only — the ledger is the source of truth** (it computes live figures like loan interest, but posts nothing).
- Same-person disambiguation by **father's name / village-city / phone**.

### 3.12 Party (filter search & insights)
A query tool over **every party** — stack filters (combined with **AND**; numbers support **= / ≤ / ≥ / between**) to answer questions across the whole app.
- Filter by **identity** (type, subgroup, village, phone, defaulter, multi-role), **stock** (packets brought, aamads, current stock, location), **sales** (packets sold, to/from a party), **balance** (owes us / we owe, amount, aging), **rent** (standing bhada), **loans** (outstanding, type, overdue), **bardana**, and **activity**.
  > e.g. "kisans who brought ≤ 500 packets and still owe > ₹10,000".
- Results list shows name · son-of · village · phone · role · balance + the filtered metric, with count + totals; **saved presets**; each row clicks through to that party's Bill / ledger.

### 3.13 Year-end Close
A **dedicated, password-gated** feature that closes the year in **one button**, in order:
1. carry each balance forward as next year's opening,
2. convert unpaid dues into **indirect loans** (interest from 1 Jan),
3. **capitalise** loan interest,
4. **flag defaulters**,
5. **reset the stock maps** (leftover packets disposed).

It shows a **summary** (accounts carried forward, total dues, new defaulters, indirect loans + total, interest capitalised, maps cleared) and an **exceptions list** (odd balances, pending cheques, inconsistencies). It's **reversible** via a pre-close snapshot and saves a closing report.

---

## 4. How it all works together

**Filling season:** a kisan brings potatoes → **Aamad** records the packets and their racks → they appear on the **Aamad** and **Current Stock** maps → his **rent** for the year is now owed (full stored × rate).

**Selling:** the kisan agrees a price with a vyapari → recorded as a **Sauda** (or straight to Nikasi) → packets leave on a **Nikasi** gate pass → the maps update (Nikasi up, Current Stock down) → the Nikasi posts **vyapari owes / kisan credited**, and recovers an agreed slice of **bhada**.

**Money:** the vyapari pays the cold (**Receipt**, cheque clears later) → the cold settles the kisan — **rent first**, then loan repayment and/or **cash paid out** (**Payment**) per his choice. All of this flows through the **Money Book** (cash/bank) and each party's **ledger** and **Bill**.

**Loans** run alongside, accruing interest. **Bardana** is a separate buy/sell sub-ledger.

**Year-end:** whatever is unpaid becomes the party's **opening balance**, a **defaulter** flag, and an **indirect loan**; physical stock is wiped; the new year starts clean.

---

## 5. Login, users, safety
- **Login asks: year · username · password · accountant.** The *year* sets the working accounting year; *username/password* authenticate; the *accountant* name is stamped on every entry.
- **Audit trail** — every create / edit / void is logged with who and when; nothing is hard-deleted (only voided/reversed).
- **Automatic backups** — the whole database is one file, copied on open/close and snapshotted before a year-end close.
