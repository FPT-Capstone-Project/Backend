const rentalService = require('../services/rental.service');

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

async function adminUpdate(req, res) {
  const rental = await rentalService.updateRentalForAdmin(req.params.rentalId, req.body || {});
  res.json({ message: 'Rental updated successfully', data: rental });
}

module.exports = { adminList, adminGetById, adminCreateFromOrder, adminUpdate };
