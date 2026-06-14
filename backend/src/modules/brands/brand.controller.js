const brandService = require('./brand.service');

const createBrand = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const brand = await brandService.createBrand(ownerId, req.body);
    res.status(201).json({ success: true, data: brand });
  } catch (error) {
    if (error.message === 'You have already registered a brand') {
      return res.status(409).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const getBrandById = async (req, res, next) => {
  try {
    const brand = await brandService.getBrandById(req.params.id);
    if (!brand) return res.status(404).json({ success: false, message: 'Brand not found' });
    res.status(200).json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
};

const getAllBrands = async (req, res, next) => {
  try {
    const brands = await brandService.getAllBrands();
    res.status(200).json({ success: true, data: brands });
  } catch (error) {
    next(error);
  }
};

const getMyBrand = async (req, res, next) => {
  try {
    const brand = await brandService.getBrandByOwner(req.user._id);
    if (!brand) return res.status(404).json({ success: false, message: 'You have not registered a brand yet' });
    res.status(200).json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
};

const getEnrolledSellers = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const sellers = await brandService.getEnrolledSellers(req.params.id, ownerId);
    res.status(200).json({ success: true, data: sellers });
  } catch (error) {
    if (error.message === 'Brand not found or unauthorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const getEnrolledSellerProducts = async (req, res, next) => {
  try {
    return res.status(403).json({
      success: false,
      message: 'Unauthorized: Brand owners are not permitted to track all products of enrolled sellers'
    });
  } catch (error) {
    next(error);
  }
};

const getFlaggedProducts = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const products = await brandService.getFlaggedProducts(req.params.id, ownerId);
    res.status(200).json({ success: true, data: products });
  } catch (error) {
    if (error.message === 'Brand not found or unauthorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const getPendingEnrollments = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const enrollments = await brandService.getPendingEnrollments(req.params.id, ownerId);
    res.status(200).json({ success: true, data: enrollments });
  } catch (error) {
    if (error.message === 'Brand not found or unauthorized') {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const getSellerEnrollments = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    const brands = await brandService.getSellerEnrollments(sellerId);
    res.status(200).json({ success: true, data: brands });
  } catch (error) {
    next(error);
  }
};

const requestEnrollment = async (req, res, next) => {
  try {
    const sellerId = req.user._id;
    const enrollment = await brandService.requestEnrollment(req.params.id, sellerId);
    res.status(201).json({ success: true, data: enrollment });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'You have already applied to this brand' });
    }
    if (error.message === 'Brand not found') {
      return res.status(404).json({ success: false, message: error.message });
    }
    next(error);
  }
};

const updateEnrollmentStatus = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const { id: brandId, enrollmentId } = req.params;
    const { status } = req.body;

    const enrollment = await brandService.updateEnrollmentStatus(brandId, enrollmentId, ownerId, status);
    res.status(200).json({ success: true, data: enrollment });
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('unauthorized')) {
      return res.status(403).json({ success: false, message: error.message });
    }
    next(error);
  }
};

module.exports = {
  createBrand,
  getBrandById,
  getAllBrands,
  getMyBrand,
  getEnrolledSellers,
  getEnrolledSellerProducts,
  getFlaggedProducts,
  getPendingEnrollments,
  requestEnrollment,
  updateEnrollmentStatus,
  getSellerEnrollments,
};
