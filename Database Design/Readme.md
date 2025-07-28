# 📦 Inventory Management Database System

## 📋 Overview

This project defines the schema for a robust **Inventory Management Database** that supports multiple companies, warehouses, suppliers, bundled products, and inventory auditing. It is optimized for real-world enterprise scenarios where tracking and flexibility are key.

---

## 🎯 Requirements Addressed

| Requirement             | Description                                                                 |
|-------------------------|-----------------------------------------------------------------------------|
| ✅ Multi-warehouse support | Companies can manage and operate across multiple warehouses.               |
| ✅ Flexible inventory      | Products can be stored in different quantities across various warehouses.  |
| ✅ Change tracking         | Complete audit trail of inventory level changes is maintained.            |
| ✅ Supplier management     | Multiple suppliers can be linked to provide the same or different products.|
| ✅ Product bundles         | Products can be defined as bundles (composed of other products).           |

---

## 🗂️ Database Schema

![Database Schema](https://github.com/user-attachments/assets/ba12140a-d93e-49c6-8b1d-4823c9fc449d)

### Core Tables and Relationships

| Table             | Purpose                        | Key Features                                                                 |
|------------------|----------------------------------|------------------------------------------------------------------------------|
| `companies`       | Business entities               | Basic company details                                                        |
| `warehouses`      | Storage locations               | Linked to companies (1:N relationship)                                       |
| `products`        | Product catalog                 | Supports both individual and bundled products                                |
| `suppliers`       | Vendor management               | Contact and business information                                             |
| `inventory`       | Current stock levels            | Real-time tracking of quantities by warehouse and product                    |
| `inventory_history` | Change audit trail             | Maintains a log of every inventory movement                                  |
| `product_bundles` | Bundle definitions              | Many-to-many, self-referencing relationship for bundled products             |
| `supplier_products`| Supplier-product mappings      | Includes pricing, lead times, and availability                               |

---

## 🔄 Entity Relationships

- `Companies (1) ←→ (M) Warehouses`
- `Products (M) ←→ (M) Warehouses` (via `inventory`)
- `Suppliers (M) ←→ (M) Products` (via `supplier_products`)
- `Products (M) ←→ (M) Products` (via `product_bundles`, self-referencing)

---

## ⚙️ Design Decisions

###  Performance Optimizations
- Separation of current (`inventory`) vs historical (`inventory_history`) data for faster queries
- Strategic indexing on frequently queried columns like `product_id`, `warehouse_id`, `company_id`
- Composite unique keys on linking tables to prevent duplicate entries

###  Data Integrity
- Foreign key constraints with `ON DELETE CASCADE` to maintain referential integrity
- Use of `ENUM` types for standardizing values (e.g., `movement_type`, `status`)
- `NOT NULL` constraints on essential fields to prevent incomplete data

---

## ❓ Missing Requirements / Open Questions

###  User Management
- Who can view or modify inventory?
- Do we need **role-based access controls** (e.g., admin, warehouse manager, viewer)?
- Should the system support **multi-tenant access control** (per company)?

### Product Information

- Do products have categories (electronics, furniture, etc.)?
- Do we track expiration dates?
- Do we need product images or descriptions?
- Are there different sizes/colors for same product?

> 🔔 *These need clarification from the product team before implementation.*

---


