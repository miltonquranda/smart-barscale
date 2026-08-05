// Configure STRIPE_SECRET_KEY through the Functions environment; never
// commit payment credentials to source control.
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');

export default class StripeCtrl {
  test = (req, res) => {
    stripe.customers.create({
      card : req.body.stripeToken,
      email : "...", // customer's email (get it from db or session)
      plan : "browserling_developer"
    }, function (err, customer) {
      if (err) {
        var msg = customer.error.message || "unknown";
        res.send("Error while processing your payment: " + msg);
      }
      else {
        var id = customer.id;
        console.log('Success! Customer with Stripe ID ' + id + ' just signed up!');
        // save this customer to your database here!
        res.send('ok');
      }
    });
  }

  subscription = (id, token) => {
    // return stripe.charges.create({
    //   amount: 1200,
    //   currency: 'usd',
    //   description: 'Example charge',
    //   source: token.id,
    // });

    return stripe.invoiceItems.create({
      amount: 10000,
      currency: 'usd',
      customer: id,
      description: 'One-time setup fee',
    }).then(() => {
      return stripe.subscriptions.create({
        customer: id,
        items: [
          {
            plan: 'plan_FZxbP0xcp20zvo',
          },
        ],
        expand: ['latest_invoice.payment_intent'],
      });
    });
  }

  createCustomer = (email, token) => {
    return stripe.customers.create({
      email,
      source: token.id,
    });
  }

  retrieveCustomer = (req, res) => {
    stripe.customers.retrieve(
      req.params.customerId,
      function(err, customer) {
        // asynchronously called
        if (err) {
          console.log('error', err);
          console.log('err cus', customer)

          res.send("Error while processing your payment: ");
        } else {
          console.log(customer);
          // save this customer to your database here!

          res.status(200).json(customer);
        }
      }
    );
  }
}
