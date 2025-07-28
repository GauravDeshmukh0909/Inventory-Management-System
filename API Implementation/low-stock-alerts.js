const express = require('express');
const { ObjectId } = require('mongodb');
const router = express.Router();

/**
 * ASSUMPTIONS ABOUT DATABASE SCHEMA:
 * 
 * Collections:
 * 1. companies: { _id, name, settings: { lowStockThresholds: { productType: threshold } } }
 * 2. products: { _id, name, sku, type, companyId, supplierId, isActive }
 * 3. warehouses: { _id, name, companyId, location }
 * 4. inventory: { _id, productId, warehouseId, currentStock, lastUpdated }
 * 5. suppliers: { _id, name, contactEmail, phone }
 * 6. sales: { _id, productId, warehouseId, quantity, saleDate, companyId }
 * 
 * BUSINESS LOGIC ASSUMPTIONS:
 * - Recent sales activity = sales within last 30 days
 * - Low stock threshold defaults by product type: electronics=50, clothing=20, food=100, other=10
 * - Days until stockout calculated based on average daily sales over last 30 days
 * - Only active products are considered for alerts
 */

/**
 * GET /api/companies/{company_id}/alerts/low-stock
 * Returns low-stock alerts for products with recent sales activity
 */
router.get('/companies/:company_id/alerts/low-stock', async (req, res) => {
  try {
    const { company_id } = req.params;
    const { warehouse_id, product_type, limit = 100 } = req.query;

    // Validate company_id format
    if (!ObjectId.isValid(company_id)) {
      return res.status(400).json({
        error: 'Invalid company ID format',
        code: 'INVALID_COMPANY_ID'
      });
    }

    const companyObjectId = new ObjectId(company_id);

    // Verify company exists
    const company = await req.db.collection('companies').findOne({
      _id: companyObjectId
    });

    if (!company) {
      return res.status(404).json({
        error: 'Company not found',
        code: 'COMPANY_NOT_FOUND'
      });
    }

    // Get default thresholds from company settings or use defaults
    const defaultThresholds = {
      electronics: 50,
      clothing: 20,
      food: 100,
      other: 10,
      ...company.settings?.lowStockThresholds
    };

    // Build aggregation pipeline
    const pipeline = [
      // Start with products for this company
      {
        $match: {
          companyId: companyObjectId,
          isActive: { $ne: false }, // Include products where isActive is true or undefined
          ...(product_type && { type: product_type })
        }
      },
      
      // Join with inventory data
      {
        $lookup: {
          from: 'inventory',
          localField: '_id',
          foreignField: 'productId',
          as: 'inventory'
        }
      },
      
      // Filter out products without inventory
      {
        $match: {
          'inventory.0': { $exists: true }
        }
      },
      
      // Unwind inventory to process each warehouse separately
      { $unwind: '$inventory' },
      
      // Filter by warehouse if specified
      ...(warehouse_id ? [{
        $match: {
          'inventory.warehouseId': new ObjectId(warehouse_id)
        }
      }] : []),
      
      // Check for recent sales activity (last 30 days)
      {
        $lookup: {
          from: 'sales',
          let: { 
            productId: '$_id',
            warehouseId: '$inventory.warehouseId'
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$productId', '$$productId'] },
                    { $eq: ['$warehouseId', '$$warehouseId'] },
                    { $gte: ['$saleDate', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)] }
                  ]
                }
              }
            },
            {
              $group: {
                _id: null,
                totalSold: { $sum: '$quantity' },
                salesCount: { $sum: 1 }
              }
            }
          ],
          as: 'recentSales'
        }
      },
      
      // Only include products with recent sales activity
      {
        $match: {
          'recentSales.0': { $exists: true }
        }
      },
      
      // Add calculated fields
      {
        $addFields: {
          threshold: {
            $switch: {
              branches: [
                { case: { $eq: ['$type', 'electronics'] }, then: defaultThresholds.electronics },
                { case: { $eq: ['$type', 'clothing'] }, then: defaultThresholds.clothing },
                { case: { $eq: ['$type', 'food'] }, then: defaultThresholds.food }
              ],
              default: defaultThresholds.other
            }
          },
          currentStock: '$inventory.currentStock',
          dailyAverageSales: {
            $divide: [
              { $ifNull: [{ $arrayElemAt: ['$recentSales.totalSold', 0] }, 0] },
              30
            ]
          }
        }
      },
      
      // Filter for low stock (current stock <= threshold)
      {
        $match: {
          $expr: { $lte: ['$currentStock', '$threshold'] }
        }
      },
      
      // Calculate days until stockout
      {
        $addFields: {
          daysUntilStockout: {
            $cond: {
              if: { $gt: ['$dailyAverageSales', 0] },
              then: { 
                $round: [
                  { $divide: ['$currentStock', '$dailyAverageSales'] },
                  0
                ]
              },
              else: null // Can't calculate without sales data
            }
          }
        }
      },
      
      // Join with warehouse information
      {
        $lookup: {
          from: 'warehouses',
          localField: 'inventory.warehouseId',
          foreignField: '_id',
          as: 'warehouse'
        }
      },
      
      // Join with supplier information
      {
        $lookup: {
          from: 'suppliers',
          localField: 'supplierId',
          foreignField: '_id',
          as: 'supplier'
        }
      },
      
      // Project final structure
      {
        $project: {
          product_id: '$_id',
          product_name: '$name',
          sku: 1,
          warehouse_id: '$inventory.warehouseId',
          warehouse_name: { $arrayElemAt: ['$warehouse.name', 0] },
          current_stock: '$currentStock',
          threshold: 1,
          days_until_stockout: '$daysUntilStockout',
          supplier: {
            id: { $arrayElemAt: ['$supplier._id', 0] },
            name: { $arrayElemAt: ['$supplier.name', 0] },
            contact_email: { $arrayElemAt: ['$supplier.contactEmail', 0] }
          },
          // Sort priority: lowest stock ratio first, then shortest time to stockout
          _sortPriority: {
            $divide: ['$currentStock', '$threshold']
          }
        }
      },
      
      // Sort by priority (most critical first)
      {
        $sort: {
          _sortPriority: 1,
          days_until_stockout: 1
        }
      },
      
      // Remove sort field from output
      {
        $project: {
          _sortPriority: 0
        }
      },
      
      // Limit results
      { $limit: parseInt(limit) }
    ];

    // Execute aggregation
    const alerts = await req.db.collection('products')
      .aggregate(pipeline)
      .toArray();

    // Get total count for pagination info
    const countPipeline = [...pipeline];
    countPipeline.pop(); // Remove limit
    countPipeline.push({ $count: 'total' });
    
    const countResult = await req.db.collection('products')
      .aggregate(countPipeline)
      .toArray();
    
    const totalAlerts = countResult.length > 0 ? countResult[0].total : 0;

    // Handle edge cases in response data
    const sanitizedAlerts = alerts.map(alert => ({
      ...alert,
      // Ensure supplier info is present even if supplier not found
      supplier: alert.supplier.id ? alert.supplier : {
        id: null,
        name: 'Unknown Supplier',
        contact_email: null
      },
      // Ensure warehouse name is present
      warehouse_name: alert.warehouse_name || 'Unknown Warehouse',
      // Handle null days_until_stockout
      days_until_stockout: alert.days_until_stockout !== null 
        ? alert.days_until_stockout 
        : 'Unable to calculate'
    }));

    res.json({
      alerts: sanitizedAlerts,
      total_alerts: totalAlerts,
      company_id: company_id,
      filters_applied: {
        warehouse_id: warehouse_id || null,
        product_type: product_type || null
      },
      generated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Low stock alerts error:', error);

    // Handle specific MongoDB errors
    if (error.name === 'MongoError' || error.name === 'MongoServerError') {
      return res.status(500).json({
        error: 'Database operation failed',
        code: 'DATABASE_ERROR'
      });
    }

    // Handle validation errors
    if (error.name === 'CastError') {
      return res.status(400).json({
        error: 'Invalid parameter format',
        code: 'INVALID_PARAMETER'
      });
    }

    // Generic error response
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
 * ADDITIONAL HELPER ENDPOINTS
 */
// Get company's low stock thresholds
router.get('/companies/:company_id/settings/thresholds', async (req, res) => {
  try {
    const { company_id } = req.params;
    
    if (!ObjectId.isValid(company_id)) {
      return res.status(400).json({ error: 'Invalid company ID' });
    }

    const company = await req.db.collection('companies').findOne(
      { _id: new ObjectId(company_id) },
      { projection: { 'settings.lowStockThresholds': 1 } }
    );

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const thresholds = {
      electronics: 50,
      clothing: 20,
      food: 100,
      other: 10,
      ...company.settings?.lowStockThresholds
    };

    res.json({ thresholds });
  } catch (error) {
    console.error('Thresholds fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update company's low stock thresholds
router.put('/companies/:company_id/settings/thresholds', async (req, res) => {
  try {
    const { company_id } = req.params;
    const { thresholds } = req.body;

    if (!ObjectId.isValid(company_id)) {
      return res.status(400).json({ error: 'Invalid company ID' });
    }

    // Validate thresholds
    if (!thresholds || typeof thresholds !== 'object') {
      return res.status(400).json({ error: 'Invalid thresholds format' });
    }

    const validTypes = ['electronics', 'clothing', 'food', 'other'];
    const filteredThresholds = {};

    for (const [type, threshold] of Object.entries(thresholds)) {
      if (validTypes.includes(type) && typeof threshold === 'number' && threshold > 0) {
        filteredThresholds[type] = threshold;
      }
    }

    const result = await req.db.collection('companies').updateOne(
      { _id: new ObjectId(company_id) },
      { $set: { 'settings.lowStockThresholds': filteredThresholds } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({ 
      message: 'Thresholds updated successfully',
      thresholds: filteredThresholds 
    });
  } catch (error) {
    console.error('Thresholds update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// app.js or server.js
const lowStockAlerts = require('./routes/low-stock-alerts');
app.use('/api', lowStockAlerts);
