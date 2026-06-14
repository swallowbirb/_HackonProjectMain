const User = require("./user.model");

const syncUser = async (userData) => {
  const { clerkId, email, firstName, lastName, avatarUrl, role } = userData;

  let user = await User.findOne({ clerkId });

  if (!user) {
    user = await User.create({
      clerkId,
      email,
      firstName,
      lastName,
      avatarUrl,
      ...(role && { role }),
    });
  } else {
    user.email = email;
    user.firstName = firstName;
    user.lastName = lastName;
    user.avatarUrl = avatarUrl;
    if (role) user.role = role;
    await user.save();
  }

  return user;
};

const getUserById = async (id) => {
  return await User.findById(id).select("-clerkId").lean();
};

const deleteUser = async (clerkId) => {
  return await User.findOneAndDelete({ clerkId });
};

module.exports = {
  syncUser,
  getUserById,
  deleteUser,
};
