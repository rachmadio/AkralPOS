const AKRAL_PRODUCTS = [
  { id: "coffee-americano", name: "Americano", category: "Coffee", price: 18000, imageURL: "/assets/akral-cup.jpg", color: "#2b170e" },
  { id: "coffee-kopi-susu-aren", name: "Kopi Susu Aren", category: "Coffee", price: 28000, imageURL: "/assets/akral-cup.jpg", color: "#a86f3a" },
  { id: "coffee-berry-in-bloom", name: "Berry In Bloom", category: "Coffee", price: 30000, imageURL: "/assets/akral-cup.jpg", color: "#b8436a" },
  { id: "coffee-kopi-susu-laviberry", name: "Kopi Susu Laviberry", category: "Coffee", price: 30000, imageURL: "/assets/akral-cup.jpg", color: "#9d6aa8" },
  { id: "coffee-latte", name: "Latte", category: "Coffee", price: 28000, imageURL: "/assets/akral-cup.jpg", color: "#c79262" },
  { id: "coffee-vanilla-latte", name: "Vanilla Latte", category: "Coffee", price: 35000, imageURL: "/assets/akral-cup.jpg", color: "#d8b783" },
  { id: "coffee-caramel-latte", name: "Caramel Latte", category: "Coffee", price: 35000, imageURL: "/assets/akral-cup.jpg", color: "#b87436" },
  { id: "coffee-berry-jam-latte", name: "Berry Jam Latte", category: "Coffee", price: 35000, imageURL: "/assets/akral-cup.jpg", color: "#c05b78" },
  { id: "coffee-manual-brew", name: "Manual Brew", category: "Coffee", price: null, imageURL: "/assets/akral-cup.jpg", color: "#704126", variablePrice: true },
  { id: "noncoffee-matcha", name: "Matcha", category: "Non Coffee", price: 28000, imageURL: "/assets/akral-cup.jpg", color: "#6d8b43" },
  { id: "noncoffee-cereal-matcha", name: "Cereal Matcha", category: "Non Coffee", price: 35000, imageURL: "/assets/akral-cup.jpg", color: "#93a65b" },
  { id: "noncoffee-matcha-berry", name: "Matcha Berry", category: "Non Coffee", price: 28000, imageURL: "/assets/akral-cup.jpg", color: "#8b8a4d" },
  { id: "noncoffee-hojicha", name: "Hojicha", category: "Non Coffee", price: 28000, imageURL: "/assets/akral-cup.jpg", color: "#8f6b45" },
  { id: "noncoffee-red-velvet", name: "Red Velvet", category: "Non Coffee", price: 28000, imageURL: "/assets/akral-cup.jpg", color: "#a8343c" },
  { id: "noncoffee-coklat", name: "Coklat", category: "Non Coffee", price: 28000, imageURL: "/assets/akral-cup.jpg", color: "#69402e" }
];

const PRODUCT_HEADERS = ["ID", "Name", "Category", "Price", "ImageURL"];
const ORDER_HEADERS = ["OrderID", "Date", "Time", "Items", "Subtotal", "Discount", "DiscountType", "Tax", "Total", "PaymentMethod"];
const ANALYTICS_HEADERS = ["Date", "Revenue", "Orders", "BestSeller"];

module.exports = {
  AKRAL_PRODUCTS,
  PRODUCT_HEADERS,
  ORDER_HEADERS,
  ANALYTICS_HEADERS
};
