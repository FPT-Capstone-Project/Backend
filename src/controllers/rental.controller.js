const rentalService = require('../services/rental.service');
const notificationService = require('../services/notification.service');

async function adminList(req, res) {
  const result = await rentalService.getAllRentalsForAdmin(req.query || {});
  res.json({ data: result.rentals, pagination: result.pagination });
}

async function adminGetById(req, res) {
  const rental = await rentalService.getRentalByIdForAdmin(req.params.rentalId);
  res.json({ data: rental });
}

async function adminCreateFromOrder(req, res) {
  const result = await rentalService.createRentalFromOrderForAdmin(
    req.body && (req.body.orderId ?? req.body.order_id),
  );
  res.status(result.created ? 201 : 200).json({
    message: result.created ? 'Rental created successfully' : 'Rental already exists for this order',
    data: result.rental,
  });
}

async function adminStartCultivation(req, res) {
  const result = await rentalService.startCultivationForAdmin(
    req.params.rentalId,
    req.body || {},
    req.user.user_id,
  );
  res.status(201).json({
    message: 'Cultivation session started successfully',
    data: result,
  });
}

async function adminUpdate(req, res) {
  const rental = await rentalService.updateRentalForAdmin(
    req.params.rentalId,
    req.body || {},
    req.user.user_id,
  );
  res.json({ message: 'Rental updated successfully', data: rental });
}

async function adminCreateProgress(req, res) {
  const progress = await rentalService.createProgressForAdmin(
    req.params.rentalId,
    req.body || {},
    req.user.user_id,
  );
  res.status(201).json({ message: 'Cultivation progress recorded successfully', data: progress });
}

async function adminCreateHarvest(req, res) {
  const harvest = await rentalService.createHarvestForAdmin(
    req.params.rentalId,
    req.body || {},
    req.user.user_id,
  );
  res.status(201).json({ message: 'Harvest recorded successfully', data: harvest });
}

async function adminComplete(req, res) {
  const result = await rentalService.completeRentalForAdmin(
    req.params.rentalId,
    req.body || {},
    req.user.user_id,
  );
  res.json({ message: 'Rental completed successfully', data: result });
}

async function adminCancel(req, res) {
  const result = await rentalService.cancelRentalForAdmin(
    req.params.rentalId,
    req.body || {},
    req.user.user_id,
  );
  res.json({ message: 'Rental cancelled successfully', data: result });
}

async function adminCreateNotification(req, res) {
  const notification = await notificationService.sendRentalNotification(
    req.params.rentalId,
    req.body || {},
    req.user.user_id,
  );
  res.status(201).json({ message: 'Notification sent', data: notification });
}

module.exports = {
  adminList,
  adminGetById,
  adminCreateFromOrder,
  adminStartCultivation,
  adminUpdate,
  adminCreateProgress,
  adminCreateHarvest,
  adminComplete,
  adminCancel,
  adminCreateNotification,
};
