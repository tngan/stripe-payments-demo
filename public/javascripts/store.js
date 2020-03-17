/**
 * store.js
 * Stripe Payments Demo. Created by Romain Huet (@romainhuet)
 * and Thorsten Schaeff (@thorwebdev).
 *
 * Representation of products, and line items stored in Stripe.
 * Please note this is overly simplified class for demo purposes (all products
 * are loaded for convenience, there is no cart management functionality, etc.).
 * A production app would need to handle this very differently.
 */

class Store {
  constructor() {
    this.lineItems = [];
    this.products = {};
    this.quantity = {};
    this.config = null;
    this.productsFetchPromise = null;
    this.displayPaymentSummary();
    this.paymentIntent = null;
  }

  // Compute the total for the payment based on the line items (SKUs and quantity).
  getPaymentTotal() {
    return Object.values(this.lineItems).reduce(
      (total, {product, sku, quantity}) =>
        total + (quantity ? quantity : 0) * this.products[product].skus.data[0].price,
      0
    );
  }

  // Expose the line items for the payment using products and skus stored in Stripe.
  getLineItems() {
    let items = [];
    this.lineItems.forEach(item =>
      items.push({
        type: 'sku',
        parent: item.sku,
        quantity: item.quantity,
      })
    );
    return items;
  }

  // Retrieve the configuration from the API.
  async getConfig() {
    try {
      const response = await fetch('/config');
      const config = await response.json();
      if (config.stripePublishableKey.includes('live')) {
        // Hide the demo notice if the publishable key is in live mode.
        document.querySelector('#order-total .demo').style.display = 'none';
      }
      this.config = config;
      return config;
    } catch (err) {
      return {error: err.message};
    }
  }

  // Retrieve a SKU for the Product where the API Version is newer and doesn't include them on v1/product
  async loadSkus(product_id) {
    try {
      const response = await fetch(`/products/${product_id}/skus`);
      const skus = await response.json();
      this.products[product_id].skus = skus;
    } catch (err) {
      return {error: err.message};
    }
  }

  // Load the product details.
  loadProducts() {
    if (!this.productsFetchPromise) {
      this.productsFetchPromise = new Promise(async resolve => {
        const productsResponse = await fetch('/products');
        const products = (await productsResponse.json()).data;
        if (!products.length) {
          throw new Error(
            'No products on Stripe account! Make sure the setup script has run properly.'
          );
        }
        // Check if we have SKUs on the product, otherwise load them separately.
        for (const product of products) {
          this.products[product.id] = product;
          this.quantity[product.id] = 0;
          if (!product.skus) {
            await this.loadSkus(product.id);
          }
        }
        resolve();
      });
    }
    return this.productsFetchPromise;
  }

  // Create the PaymentIntent with the cart details.
  async createPaymentIntent(currency, items) {

    if (items.every(i => !i.quantity)) {
      // skip when all quantity of items are zero
      return;
    }

    try {
      const response = await fetch('/payment_intents', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          currency,
          items,
        }),
      });
      const data = await response.json();

      store.paymentIntent = data.paymentIntent;

      if (data.error) {
        return {error: data.error};
      } else {
        return data;
      }
    } catch (err) {
      return {error: err.message};
    }
  }

  // Create the PaymentIntent with the cart details.
  async updatePaymentIntentWithShippingCost(
    paymentIntent,
    items,
    shippingOption
  ) {
    try {
      const response = await fetch(
        `/payment_intents/${paymentIntent}/shipping_change`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            shippingOption,
            items,
          }),
        }
      );
      const data = await response.json();
      if (data.error) {
        return {error: data.error};
      } else {
        return data;
      }
    } catch (err) {
      return {error: err.message};
    }
  }

  // Format a price (assuming a two-decimal currency like EUR or USD for simplicity).
  formatPrice(amount, currency) {
    let price = amount.toFixed(2);
    let numberFormat = new Intl.NumberFormat(['en-US'], {
      style: 'currency',
      currency: currency,
      currencyDisplay: 'symbol',
    });
    return numberFormat.format(price);
  }

  // Manipulate the DOM to display the payment summary on the right panel.
  // Note: For simplicity, we're just using template strings to inject data in the DOM,
  // but in production you would typically use a library like React to manage this effectively.
  async displayPaymentSummary() {
    // Fetch the products from the store to get all the details (name, price, etc.).
    await this.loadProducts();
    const orderItems = document.getElementById('order-items');
    let currency;
    // Build and append the line items to the payment summary.
    for (let [id, product] of Object.entries(this.products)) {
      const quantity = this.quantity[id];
      let sku = product.skus.data[0];
      let skuPrice = this.formatPrice(sku.price, sku.currency);
      let lineItemPrice = this.formatPrice(sku.price * quantity, sku.currency);
      let lineItem = document.createElement('div');
      lineItem.classList.add('line-item');
      lineItem.innerHTML = `
        <div>
          <img class="image" src="/images/products/${product.id}.png" alt="${product.name}">
        </div>
        <div class="product-container">
          <div class="product-metadata">
            <p class="product">${product.name}</p>
            <div class="purchase-info">
              <input id="quantity-input-${product.id}" class="quantity-input" type="number" value="${this.quantity[product.id]}" oninput="store.updateQuantity('${product.id}')" />
              <p class="count"> x ${skuPrice}</p>
              <p id="price-${product.id}" class="price">${lineItemPrice}</p>
            </div>
          </div>
          <p class="sku">${sku.attributes.description}</p>
        </div>
      `;
      orderItems.appendChild(lineItem);
      currency = sku.currency;
      this.lineItems.push({
        product: product.id,
        sku: sku.id,
        quantity,
      });
    }
    this.rerenderTotal(currency);
  }

  updateQuantity(id) {
    const quantity = parseInt(document.getElementById(`quantity-input-${id}`).value);
    this.quantity[id] = quantity ? quantity : 0;
    const targetItem = this.lineItems.find(item => item.product === id);
    if (targetItem) {
      targetItem.quantity = quantity;
    }
    this.updateTotal();
    // create payment intent whenever quantity is changed
    this.createPaymentIntent(this.config.currency, this.getLineItems());
  }

  updateTotal() {
    let currency;
    for (let [id, product] of Object.entries(this.products)) {
      const sku = product.skus.data[0];
      const quantity = this.quantity[id];
      currency = sku.currency;
      // price item subtotal
      const priceElement = document.getElementById(`price-${id}`);
      const itemTotal = sku.price * quantity;
      const displayItemTotal = this.formatPrice(itemTotal ? itemTotal : 0, currency);
      priceElement.innerText = displayItemTotal;
    }  
    const displayedTotal = this.rerenderTotal(currency);
    this.updateButtonLabel(displayedTotal);
  }

  rerenderTotal(currency) {
    const orderTotal = document.getElementById('order-total');
    const paymentTotal = this.getPaymentTotal();
    const displayTotal = this.formatPrice(paymentTotal ? paymentTotal : 0, currency);
    orderTotal.querySelector('[data-subtotal]').innerText = displayTotal;
    orderTotal.querySelector('[data-total]').innerText = displayTotal;
    return displayTotal;
  }

  updateButtonLabel(amount) {
    const form = document.getElementById('payment-form');
    const submitButton = form.querySelector('button[type=submit]');
    const label = `Pay ${amount}`;
    submitButton.innerText = label;
  };

  async createCharge(token, metadata) {
    const amount = this.getPaymentTotal();
    try {
      const response = await fetch(`/charges`,
        {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            source: token,
            amount: amount,
            currency: this.config.currency,
            metadata: metadata
          }),
        }
      );
      return await response.json();
    } catch(e) {
      console.error('failed to create a charge', e);
    }
  }

}

window.store = new Store();
