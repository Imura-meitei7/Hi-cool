import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB_EcCWXwWubry4D4avPmVwoEW32sgl40A",
  authDomain: "hi-cool.firebaseapp.com",
  projectId: "hi-cool",
  storageBucket: "hi-cool.firebasestorage.app",
  messagingSenderId: "1044387613369",
  appId: "1:1044387613369:web:3fa046d38e1b8e6663e968",
  measurementId: "G-3QMZ3LJQP7"
};

// Firebase の初期化
const app = initializeApp(firebaseConfig);

// クラウドデータベース（Firestore）の準備
export const db = getFirestore(app);