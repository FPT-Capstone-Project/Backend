# Harvest delivery complaints

The existing complaints table must include `order_id` and the legacy seven-value status constraint. The API uses those database statuses directly and does not require a status migration.

All endpoints require a Bearer JWT. Customers have role 3; staff have role 1 or 2.

| Method | Endpoint | Access | Input |
| --- | --- | --- | --- |
| POST | /api/orders/:orderId/complaints | Customer | Multipart: complaintType, description, optional images[] (up to 10 files, 5 MB each) |
| GET | /api/complaints/my | Customer | page, pageSize (max 100), optional status |
| GET | /api/complaints/my/:id | Owner | Complaint and order details |
| GET | /api/complaints | Staff | Same pagination and status filter |
| GET | /api/complaints/:id | Owner or staff | Complaint details |
| POST | /api/complaints/:id/replies | Owner or staff | JSON or multipart: message, optional customer images[] |
| PATCH | /api/complaints/:id/assign | Staff | assignedTo (eligible staff ID or null) |
| PATCH | /api/complaints/:id/status | Staff | status, optional resolution |
| PATCH | /api/complaints/:id | Staff | Combined assignment/status/resolution update |

Submit a complaint as `multipart/form-data`, with text fields `complaintType` and `description`, and optional image files in the repeated `images` field. The server uploads each image to Cloudinary and stores the returned secure URL in `image_urls`; callers do not submit image URLs. Up to 10 images are accepted, with a 5 MB limit per file. Snake case complaint type and assignment inputs remain supported.

The API uses the existing database status values: PENDING, UNDER_REVIEW, NEED_MORE_INFO, RESOLVING, RESOLVED, REJECTED and CLOSED. New complaints start as PENDING. Creation verifies order ownership through orders.user_id, a DELIVERY harvest request linked through cultivation sessions and order items, and DELIVERED status on the latest shipment for that order. PICKUP-only orders are rejected. New submissions reject orders that already have a complaint, using an order lock to serialize concurrent submissions. Historical complaints from multiple shipments of one order are all preserved; the order index is intentionally nonunique. Shipment is used only for creation eligibility; complaint records and reads reference orders directly. Uploaded images are removed if creation fails.

Status transitions on the mobile workflow are event-driven. A newly assigned PENDING complaint becomes UNDER_REVIEW. Any reply from the assigned Farm Operator changes it to NEED_MORE_INFO. The customer may reply only in NEED_MORE_INFO; submitted evidence images are appended to the complaint and the status becomes RESOLVING. A nonblank operator resolution changes the complaint to RESOLVED. Farm Operators cannot set complaint statuses directly. Admin may still manage exceptional transitions on the web, including reopening or setting REJECTED/CLOSED. Replies remain blocked while the status is RESOLVED, REJECTED or CLOSED.

RESOLVED, REJECTED and CLOSED require a nonblank resolution; resolved_at is set for RESOLVED and CLOSED. Assignments require an ACTIVE Admin or Farm Operator. Staff updates and replies notify the customer; customer submissions and replies notify assigned staff or active staff when unassigned. Complaint status never changes shipment status.

Lists return { data, total, page, pageSize }; other endpoints return { data }. Complaint types accept up to 100 characters. Descriptions, reply messages and resolutions accept up to 10,000 characters.

The complaint API uses the legacy status constraint already present in the database; it does not require a status migration. Shipment and harvest workflows are unchanged.
