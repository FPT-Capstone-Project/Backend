const model = require('../models/complaint.model');
const cloudinary = require('./cloudinary.service');
const AppError = require('../utils/app-error');
const { parsePagination } = require('../utils/pagination');
const STATUSES = ['PENDING', 'UNDER_REVIEW', 'NEED_MORE_INFO', 'RESOLVING', 'RESOLVED', 'REJECTED', 'CLOSED'];

function id(value) {
  if (!['number', 'string'].includes(typeof value) || !Number.isSafeInteger(Number(value)) || Number(value) <= 0 || Number(value) > 2147483647) {
    throw new AppError('ID must be a positive integer', 400);
  }
  return Number(value);
}
function text(value, field, max = 10000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new AppError(`${field} is required and must be at most ${max} characters`, 400);
  return value.trim();
}
function status(value) {
  if (!STATUSES.includes(value)) throw new AppError(`status must be one of: ${STATUSES.join(', ')}`, 400);
  return value;
}
async function create(orderId, body, files, actor) {
  const data = { orderId: id(orderId), type: text(body.complaintType ?? body.complaint_type, 'complaintType', 100), description: text(body.description, 'description') };
  if (body.imageUrls !== undefined) throw new AppError('Upload images using the multipart "images" field', 400);
  if (!Array.isArray(files) || files.length > 10) throw new AppError('A maximum of 10 images may be uploaded', 400);
  const uploaded = [];
  try {
    return await model.create(data, actor, async () => {
      for (const file of files) uploaded.push(await cloudinary.uploadMedia(file, 'harvest-complaints'));
      return uploaded.map((image) => image.mediaUrl);
    });
  } catch (error) {
    const cleanup = await Promise.allSettled(uploaded.map((image) => cloudinary.deleteMedia(image.publicId, image.resourceType)));
    cleanup.forEach((result) => { if (result.status === 'rejected') console.error('Complaint image cleanup failed:', result.reason.message); });
    throw error;
  }
}
async function list(query, actor, mine) {
  const pagination = parsePagination(query);
  const result = await model.list(actor, { ...pagination, mine, status: query.status === undefined ? undefined : status(query.status) });
  return { ...result, page: pagination.page, pageSize: pagination.pageSize };
}
function update(complaintId, body, actor) {
  const data = {};
  if (body.status !== undefined) data.status = status(body.status);
  const assigned = body.assignedTo !== undefined ? body.assignedTo : body.assigned_to;
  if (assigned !== undefined) data.assignedTo = assigned === null ? null : id(assigned);
  if (body.resolution !== undefined) data.resolution = text(body.resolution, 'resolution');
  if (!Object.keys(data).length) throw new AppError('Provide status, assigned_to or resolution', 400);
  return model.update(id(complaintId), data, actor);
}
module.exports = { create, list, update,
  detail: (complaintId, actor) => model.detail(id(complaintId), actor),
  reply: (complaintId, body, actor) => model.reply(id(complaintId), text(body.message, 'message'), actor),
};
