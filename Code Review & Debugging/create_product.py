from flask import Flask, request, jsonify
from sqlalchemy.exc import IntegrityError
from decimal import Decimal, InvalidOperation

app = Flask(__name__)

@app.route('/api/products', methods=['POST'])
def create_product():
    try:
        data = request.get_json()

        # 1. Validate required fields
        required_fields = ['name', 'sku', 'price', 'warehouse_id', 'initial_quantity']
        missing = [f for f in required_fields if f not in data]
        if missing:
            return jsonify({"error": f"Missing fields: {', '.join(missing)}"}), 400

        # 2. Convert and validate price
        try:
            price = Decimal(str(data['price']))
            if price < 0:
                return jsonify({"error": "Price cannot be negative"}), 400
        except (InvalidOperation, TypeError):
            return jsonify({"error": "Invalid price format"}), 400

        # 3. Check if SKU already exists
        existing = Product.query.filter_by(sku=data['sku']).first()
        if existing:
            return jsonify({"error": "SKU already exists"}), 409

        # 4. Check if warehouse exists
        warehouse = Warehouse.query.get(data['warehouse_id'])
        if not warehouse:
            return jsonify({"error": "Warehouse not found"}), 404

        # 5. Create product (global, not tied to one warehouse)
        product = Product(
            name=data['name'].strip(),
            sku=data['sku'].strip().upper(),
            price=price
        )
        db.session.add(product)
        db.session.flush()  # Get product.id without committing

        # 6. Create inventory entry for this warehouse
        inventory = Inventory(
            product_id=product.id,
            warehouse_id=data['warehouse_id'],
            quantity=data['initial_quantity']
        )
        db.session.add(inventory)

        # 7. Commit everything together
        db.session.commit()

        return jsonify({
            "message": "Product created successfully",
            "product_id": product.id
        }), 201

    except IntegrityError:
        db.session.rollback()
        return jsonify({"error": "Database integrity error"}), 400

    except Exception as e:
        db.session.rollback()
        return jsonify({"error": f"Internal error: {str(e)}"}), 500
