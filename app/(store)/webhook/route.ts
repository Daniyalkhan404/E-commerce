import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import stripe from "@/lib/stripe";
import { backendClient } from "@/sanity/lib/backendClient";
import Stripe from "stripe";
import { Metadata } from "@/actions/createCheckoutSession";

export async function POST(req: NextRequest) {
    try {
        const body = await req.text();
        const headersList = await headers();
        const sig = headersList.get("stripe-signature");
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!sig || !webhookSecret) {
            console.error("Missing Stripe signature or webhook secret");
            return NextResponse.json({ error: "Unauthorized" }, { status: 400 });
        }

        let event: Stripe.Event;
        try {
            event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
        } catch (err) {
            console.error("Webhook signature verification failed:", err);
            return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
        }

        if (event.type === "checkout.session.completed") {
            const session = event.data.object as Stripe.Checkout.Session;
            try {
                const order = await createOrderInSanity(session);
                console.log("Order successfully created in Sanity:", order);
            } catch (err) {
                console.error("Failed to create order in Sanity:", err);
                return NextResponse.json({ error: "Order creation failed" }, { status: 500 });
            }
        }

        return NextResponse.json({ received: true }, { status: 200 });
    } catch (error) {
        console.error("Unexpected error handling webhook:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

async function createOrderInSanity(session: Stripe.Checkout.Session) {
    const {
        id,
        amount_total,
        currency,
        metadata,
        payment_intent,
        customer,
        total_details,
    } = session;

    if (!metadata) {
        throw new Error("Session metadata is missing");
    }

    const { orderNumber, customerName, customerEmail, clerkUserId } = metadata as Metadata;

    const lineItemsWithProduct = await stripe.checkout.sessions.listLineItems(id, {
        expand: ["data.price.product"],
    });

    const sanityProducts = lineItemsWithProduct.data.map((item) => {
        const productId = (item.price?.product as Stripe.Product)?.metadata?.id;
        if (!productId) {
            throw new Error("Product ID missing from Stripe metadata");
        }
        return {
            _key: crypto.randomUUID(),
            product: { _type: "reference", _ref: productId },
            quantity: item.quantity || 0,
        };
    });

    return backendClient.create({
        _type: "order",
        orderNumber,
        stripeCheckoutSessionId: id,
        stripePaymentIntentId: payment_intent,
        customerName,
        stripeCustomerId: customer,
        clerkUserId,
        email: customerEmail,
        currency,
        amountDiscount: (total_details?.amount_discount || 0) / 100,
        products: sanityProducts,
        totalPrice: (amount_total || 0) / 100,
        status: "paid",
        orderDate: new Date().toISOString(),
    });
}
