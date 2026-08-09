import { index, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    shopName: text("shop_name"),
    category: text("category").notNull().default("直营"),
    machineType: text("machine_type"),
    machineMode: text("machine_mode"),
    feeRate: real("fee_rate"),
    idCardFrontKey: text("id_card_front_key"),
    idCardBackKey: text("id_card_back_key"),
    bankCardCiphertext: text("bank_card_ciphertext"),
    bankCardLast4: text("bank_card_last4"),
    nextFollowUpAt: text("next_follow_up_at"),
    deletedAt: text("deleted_at"),
    purgeAfter: text("purge_after"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_customers_owner_created").on(table.ownerId, table.createdAt),
    index("idx_customers_owner_status").on(
      table.ownerId,
      table.idCardFrontKey,
      table.idCardBackKey,
    ),
    index("idx_customers_owner_category").on(table.ownerId, table.category),
    index("idx_customers_owner_shop_name").on(table.ownerId, table.shopName),
    index("idx_customers_owner_follow_up").on(
      table.ownerId,
      table.nextFollowUpAt,
    ),
    index("idx_customers_owner_deleted").on(table.ownerId, table.deletedAt),
    uniqueIndex("idx_customers_owner_phone_unique").on(table.ownerId, table.phone),
  ],
);

export const customerActivity = sqliteTable(
  "customer_activity",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    customerId: text("customer_id"),
    customerName: text("customer_name").notNull(),
    eventType: text("event_type").notNull(),
    summary: text("summary").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_customer_activity_owner_created").on(
      table.ownerId,
      table.createdAt,
    ),
    index("idx_customer_activity_owner_customer").on(
      table.ownerId,
      table.customerId,
    ),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    customerId: text("customer_id"),
    title: text("title").notNull(),
    dueAt: text("due_at"),
    status: text("status").notNull().default("open"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("idx_tasks_owner_status_due").on(
      table.ownerId,
      table.status,
      table.dueAt,
    ),
  ],
);
