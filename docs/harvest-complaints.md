# Harvest delivery complaints

Apply migrations 034 and 035 in order before deployment. Migration 035 backfills complaints.order_id from each existing shipment, adds a NOT NULL order foreign key, then removes the complaint shipment column. Complaint IDs, replies and all other fields are preserved. Migration 035 has not been applied to Supabase.

All endpoints require a Bearer JWT. Customers have role 3; staff have role 1 or 2.

| Method | Endpoint | Access | Input |
| --- | --- | --- | --- |
| POST | /api/orders/:orderId/complaints | Customer | JSON: complaintType, description, optional imageUrls |
| GET | /api/complaints/my | Customer | page, pageSize (max 100), optional status |
| GET | /api/complaints/my/:id | Owner | Complaint and order details |
| GET | /api/complaints | Staff | Same pagination and status filter |
| GET | /api/complaints/:id | Owner or staff | Complaint details |
| POST | /api/complaints/:id/replies | Owner or staff | message |
| PATCH | /api/complaints/:id/assign | Staff | assignedTo (eligible staff ID or null) |
| PATCH | /api/complaints/:id/status | Staff | status, optional resolution |
| PATCH | /api/complaints/:id | Staff | Combined assignment/status/resolution update |

Creation also supports multipart fields and optional images: up to 10 images total, 5 MB per uploaded file. JSON image URLs must use HTTPS without credentials; the server stores them without fetching them. Snake case creation and assignment inputs remain supported.

Creation verifies order ownership through orders.user_id, a DELIVERY harvest request linked through cultivation sessions and order items, and DELIVERED status on the latest shipment for that order. PICKUP-only orders are rejected. New submissions reject orders that already have a complaint, using an order lock to serialize concurrent submissions. Historical complaints from multiple shipments of one order are all preserved; the order index is intentionally nonunique. Shipment is used only for creation eligibility; complaint records and reads reference orders directly. Customer identity and initial OPEN status come from the server. Uploaded images are removed if creation fails.

Admin and Farm Operator may change directly between all five supported statuses, including reopening RESOLVED or REJECTED complaints. No step order is required. Customer replies in WAITING_CUSTOMER return it to IN_PROGRESS. Replies remain blocked while the status is RESOLVED or REJECTED.

RESOLVED and REJECTED require a nonblank resolution; resolved_at is set only for RESOLVED. Assignments require an ACTIVE Admin or Farm Operator. Staff updates and replies notify the customer; customer submissions and replies notify assigned staff or active staff when unassigned. Complaint status never changes shipment status.

Lists return { data, total, page, pageSize }; other endpoints return { data }. Complaint types accept up to 100 characters. Descriptions, reply messages and resolutions accept up to 10,000 characters.

Existing schema conflict: Supabase uses PENDING, UNDER_REVIEW, NEED_MORE_INFO, RESOLVING, RESOLVED, REJECTED and CLOSED. Migration 034 maps PENDING to OPEN, UNDER_REVIEW/RESOLVING to IN_PROGRESS, NEED_MORE_INFO to WAITING_CUSTOMER and CLOSED to RESOLVED before replacing the status constraint. Existing descriptions, images, replies and timestamps are preserved. Shipment and harvest workflows are unchanged.
