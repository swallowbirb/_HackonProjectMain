const { Webhook } = require("svix");
const userService = require("../users/user.service");

const handleClerkWebhook = async (req, res) => {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    console.error("Missing CLERK_WEBHOOK_SECRET from environment variables");
    return res.status(500).json({ error: "Server configuration error" });
  }

  // Get the headers and body
  const headers = req.headers;
  const payload = req.body;

  // Get the Svix headers for verification
  const svix_id = headers["svix-id"];
  const svix_timestamp = headers["svix-timestamp"];
  const svix_signature = headers["svix-signature"];

  // If there are no Svix headers, error out
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return res.status(400).json({ error: "Error occurred -- no svix headers" });
  }

  // Create a new Webhook instance with your secret.
  const wh = new Webhook(WEBHOOK_SECRET);

  let evt;

  // Verify the payload with the headers
  try {
    evt = wh.verify(payload.toString("utf8"), {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    });
  } catch (err) {
    console.error("Error verifying webhook:", err.message);
    return res.status(400).json({ error: "Error occurred" });
  }

  const { id } = evt.data;
  const eventType = evt.type;

  console.log(`Webhook with an ID of ${id} and type of ${eventType}`);

  try {
    if (eventType === "user.created" || eventType === "user.updated") {
      const {
        id: clerkId,
        email_addresses,
        first_name,
        last_name,
        image_url,
        public_metadata,
        unsafe_metadata,
      } = evt.data;

      const email =
        email_addresses && email_addresses.length > 0
          ? email_addresses[0].email_address
          : "";

      // Role selection implementation logic: reading from public_metadata or unsafe_metadata
      const role = public_metadata?.role || unsafe_metadata?.role || "pending";

      const userData = {
        clerkId,
        email,
        firstName: first_name,
        lastName: last_name,
        avatarUrl: image_url,
        role,
      };

      await userService.syncUser(userData);
    }

    if (eventType === "user.deleted") {
      const { id: clerkId } = evt.data;
      await userService.deleteUser(clerkId);
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error handling webhook event:", error);
    res.status(500).json({ error: "Error handling webhook event" });
  }
};

module.exports = {
  handleClerkWebhook,
};
