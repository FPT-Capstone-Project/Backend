const rentalPackageService = require('../services/rentalPackage.service');

async function list(req, res) {
  const rentalPackages = await rentalPackageService.getAllRentalPackages(req.query || {});
  res.json({ data: rentalPackages });
}

async function getById(req, res) {
  const rentalPackage = await rentalPackageService.getRentalPackageById(req.params.id);
  res.json({ data: rentalPackage });
}

async function create(req, res) {
  const rentalPackage = await rentalPackageService.createRentalPackage(req.body || {});
  res.status(201).json({ message: 'Rental package created successfully', data: rentalPackage });
}

async function update(req, res) {
  const rentalPackage = await rentalPackageService.updateRentalPackage(req.params.id, req.body || {});
  res.json({ message: 'Rental package updated successfully', data: rentalPackage });
}

async function remove(req, res) {
  const rentalPackage = await rentalPackageService.deleteRentalPackage(req.params.id);
  res.json({ message: 'Rental package deleted successfully', data: rentalPackage });
}

module.exports = { list, getById, create, update, remove };