const prisma = require('../config/database');
const { paginate, paginatedResponse, generateNumber } = require('../utils/helpers');

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, type } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = { isActive: true };
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { mobilePhone: { contains: search, mode: 'insensitive' } },
        { companyName: { contains: search, mode: 'insensitive' } },
        { customerNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take,
        include: {
          _count: { select: { jobs: true } },
          locations: { where: { isPrimary: true }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ]);

    return res.json({ success: true, ...paginatedResponse(customers, total, page, limit) });
  } catch (err) {
    console.error('customers.list error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const get = async (req, res) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        locations: { orderBy: { isPrimary: 'desc' } },
        contacts: { orderBy: { isPrimary: 'desc' } },
        jobs: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            technicians: {
              include: {
                technician: {
                  include: { user: { select: { firstName: true, lastName: true } } },
                },
              },
            },
          },
        },
        invoices: { orderBy: { createdAt: 'desc' }, take: 5 },
        serviceAgreements: { where: { status: 'active' }, take: 3 },
      },
    });

    if (!customer) {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    return res.json({ success: true, data: customer });
  } catch (err) {
    console.error('customers.get error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const create = async (req, res) => {
  try {
    const settings = await prisma.companySettings.findFirst();
    if (!settings) {
      return res.status(500).json({ success: false, error: 'Company settings not found' });
    }

    const customerNumber = generateNumber(settings.customerPrefix, settings.nextCustomerNumber);
    await prisma.companySettings.updateMany({
      data: { nextCustomerNumber: { increment: 1 } },
    });

    const { locations, contacts, ...customerData } = req.body;

    const customer = await prisma.customer.create({
      data: {
        ...customerData,
        customerNumber,
        ...(locations && {
          locations: { create: locations },
        }),
        ...(contacts && {
          contacts: { create: contacts },
        }),
      },
      include: { locations: true, contacts: true },
    });

    return res.status(201).json({ success: true, data: customer });
  } catch (err) {
    console.error('customers.create error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const update = async (req, res) => {
  try {
    const {
      customerNumber: _cn,
      id: _id,
      createdAt: _ca,
      updatedAt: _ua,
      locations: _loc,
      contacts: _con,
      ...data
    } = req.body;

    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: customer });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    console.error('customers.update error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const deleteCustomer = async (req, res) => {
  try {
    await prisma.customer.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    return res.json({ success: true, message: 'Customer deactivated successfully' });
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ success: false, error: 'Customer not found' });
    }
    console.error('customers.delete error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const getLocations = async (req, res) => {
  try {
    const locations = await prisma.location.findMany({
      where: { customerId: req.params.id },
      orderBy: { isPrimary: 'desc' },
    });
    return res.json({ success: true, data: locations });
  } catch (err) {
    console.error('customers.getLocations error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const createLocation = async (req, res) => {
  try {
    const location = await prisma.location.create({
      data: { ...req.body, customerId: req.params.id },
    });
    return res.status(201).json({ success: true, data: location });
  } catch (err) {
    console.error('customers.createLocation error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const getContacts = async (req, res) => {
  try {
    const contacts = await prisma.contact.findMany({
      where: { customerId: req.params.id },
      orderBy: { isPrimary: 'desc' },
    });
    return res.json({ success: true, data: contacts });
  } catch (err) {
    console.error('customers.getContacts error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

const createContact = async (req, res) => {
  try {
    const contact = await prisma.contact.create({
      data: { ...req.body, customerId: req.params.id },
    });
    return res.status(201).json({ success: true, data: contact });
  } catch (err) {
    console.error('customers.createContact error:', err);
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};

module.exports = {
  list,
  get,
  create,
  update,
  delete: deleteCustomer,
  getLocations,
  createLocation,
  getContacts,
  createContact,
};
