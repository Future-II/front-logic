const Ticket = require('../../infrastructure/models/ticket.model');

// Send a message to a ticket
const sendMessage = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { message } = req.body;
    const isSupportAccount = ["admin.tickets@gmail.com", "super.admin@gmail.com"].includes((req.user.email || "").toLowerCase());
    const sender = isSupportAccount ? "support" : "customer";

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Check if user is authorized (ticket creator or support/super admin)
    if (!isSupportAccount && ticket.createdBy.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const newMessage = {
      sender,
      message,
      timestamp: new Date()
    };

    ticket.messages.push(newMessage);
    ticket.updatedAt = new Date();
    await ticket.save();

    res.status(200).json({
      success: true,
      message: 'Message sent successfully',
      newMessage
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send message',
      error: error.message
    });
  }
};

// Get messages for a ticket
const getMessages = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }

    // Check if user is authorized (ticket creator or support/super admin)
    const isSupportAccount = ["admin.tickets@gmail.com", "super.admin@gmail.com"].includes((req.user.email || "").toLowerCase());
    if (!isSupportAccount && ticket.createdBy.toString() !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    res.status(200).json({
      success: true,
      messages: ticket.messages
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch messages',
      error: error.message
    });
  }
};

module.exports = {
  sendMessage,
  getMessages
};