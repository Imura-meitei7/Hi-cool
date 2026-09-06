import { useState, useEffect, type ChangeEvent } from 'react';
import Groq from 'groq-sdk';
import { db } from './firebase';
import { 
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc, 
  query, 
  orderBy 
} from 'firebase/firestore';

// 管理者用削除パスワード
const ADMIN_DELETE_PASSWORD = 'admin123';

interface Comment {
  id: string;
  text: string;
  createdAt: string;
}

interface Post {
  id: string;
  japaneseHaiku: string;
  englishHaiku: string;
  image: string | null;
  createdAt: string;
  coolCount: number;
  comments: Comment[];
}

export default function App() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isJapaneseStyle, setIsJapaneseStyle] = useState(false);

  const [text, setText] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [generatedHaikus, setGeneratedHaikus] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedJa, setSelectedJa] = useState<string>('');
  const [selectedEn, setSelectedEn] = useState<string>('');

  const [commentPostId, setCommentPostId] = useState<string | null>(null);
  const [newCommentText, setNewCommentText] = useState('');

  // Firestoreから投稿一覧を取得
  const fetchPosts = async () => {
    try {
      const q = query(collection(db, 'posts'), orderBy('createdAtTimestamp', 'desc'));
      const querySnapshot = await getDocs(q);
      const loadedPosts: Post[] = querySnapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          japaneseHaiku: data.japaneseHaiku || '',
          englishHaiku: data.englishHaiku || '',
          image: data.image || null,
          createdAt: data.createdAt || '',
          coolCount: data.coolCount || 0,
          comments: data.comments || [],
        };
      });
      setPosts(loadedPosts);
    } catch (e) {
      console.error('Firestoreからのデータ取得に失敗しました:', e);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, []);

  // 画像を選択した際に自動で最大800pxにリサイズ・軽量化する処理
  const handleImageChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        // 最大幅・高さを800pxに設定
        const MAX_SIZE = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height = Math.round((height * MAX_SIZE) / width);
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width = Math.round((width * MAX_SIZE) / height);
            height = MAX_SIZE;
          }
        }

        // Canvasを使って画像をリサイズ＆圧縮 (JPEG品質0.7)
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);

        // 軽量化したBase64文字列をセット
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
        setImage(compressedBase64);
      };
    };
    reader.readAsDataURL(file);
  };

  const generateHaiku = async () => {
    const apiKey = import.meta.env.VITE_GROQ_API_KEY;
    if (!apiKey) {
      alert('.env ファイルに VITE_GROQ_API_KEY が設定されていません。');
      return;
    }

    if (!text && !image) {
      alert('文章を入力するか、画像をアップロードしてください。');
      return;
    }

    setLoading(true);
    setGeneratedHaikus([]);
    setSelectedJa('');
    setSelectedEn('');

    try {
      const groq = new Groq({ apiKey, dangerouslyAllowBrowser: true });

// システムプロンプトで「完成された5・7・5の1本物句」と「厳格なJSON出力」を指定
      const systemPrompt = `You are a professional bilingual Haiku poet.
You MUST reply strictly in a valid JSON object format matching the schema below.
Do not output any introductory or concluding text, explanations, or markdown code blocks outside of the JSON.

CRITICAL RULES FOR JAPANESE HAIKU:
1. Each string in "japaneseHaikus" MUST be a COMPLETE, SINGLE 5-7-5 Haiku written on ONE line separated by spaces (e.g. "5音 7音 5音").
2. DO NOT output short titles, incomplete phrases, or simple sentences.
3. Count Japanese syllables (mora) strictly: 5 / 7 / 5.

EXAMPLES OF VALID "japaneseHaikus":
- "朝風や 体操終えて 参加賞"
- "夏の朝 弾む足音 ラジオ鳴る"
- "汗を拭き 笑顔あふれる 帰り道"

REQUIRED OUTPUT JSON FORMAT:
{
  "japaneseHaikus": [
    "5音句 7音句 5音句",
    "5音句 7音句 5音句",
    "5音句 7音句 5音句",
    "5音句 7音句 5音句"
  ],
  "englishHaikus": [
    "Line 1 / Line 2 / Line 3",
    "Line 1 / Line 2 / Line 3",
    "Line 1 / Line 2 / Line 3"
  ]
}`; 

      let userPrompt = 'Generate 4 Japanese haikus and 3 English 3-line haikus based on this content:\n';
      if (text) {
        userPrompt += `User Text: ${text}\n`;
      } else {
        userPrompt += `Topic: Family time, warm peaceful evening, laughter and love.\n`;
      }

      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        model: 'openai/gpt-oss-120b',
        temperature: 0.6,
        response_format: { type: 'json_object' }, // GroqにJSON出力を強制
      });

      const responseText = completion.choices[0]?.message?.content;

      if (responseText) {
        // テキストをJSONオブジェクトとして解析
        const parsedData = JSON.parse(responseText);

        const jaMatches = parsedData.japaneseHaikus || [];
        const enMatches = (parsedData.englishHaikus || []).map((h: string) =>
          h.replace(/\s*\/\s*/g, '\n').trim()
        );

        const allHaikus = [...jaMatches.slice(0, 4), ...enMatches.slice(0, 3)];

        if (allHaikus.length >= 2) {
          setGeneratedHaikus(allHaikus);
        } else {
          throw new Error('生成された俳句データが不足しています。');
        }
      }
    } catch (error: any) {
      console.error('エラーの詳細:', error);
      alert(`エラーが発生しました: ${error?.message || 'コンソールをご確認ください'}`);
    } finally {
      setLoading(false);
    }
  };

  // 新規投稿を Firestore に保存
  const handlePost = async () => {
    if (!selectedJa.trim() || !selectedEn.trim()) return;

    try {
      const now = new Date();
      const formattedDate = now.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      await addDoc(collection(db, 'posts'), {
        japaneseHaiku: selectedJa.trim(),
        englishHaiku: selectedEn.trim(),
        image: image,
        createdAt: formattedDate,
        createdAtTimestamp: now.getTime(),
        coolCount: 0,
        comments: [],
      });

      await fetchPosts();
      resetForm();
      setIsModalOpen(false);
    } catch (e) {
      console.error('投稿エラー:', e);
      alert('投稿の保存に失敗しました。');
    }
  };

  // Firestore から投稿削除
  const handleDeletePost = async (id: string) => {
    const password = window.prompt('投稿を削除するには管理者パスワードを入力してください:');
    if (password === null) return;

    if (password === ADMIN_DELETE_PASSWORD) {
      try {
        await deleteDoc(doc(db, 'posts', id));
        await fetchPosts();
        alert('投稿を削除しました。');
      } catch (e) {
        console.error('削除エラー:', e);
        alert('投稿の削除に失敗しました。');
      }
    } else {
      alert('パスワードが正しくありません。');
    }
  };

  // Firestore の Cool! カウント更新
  const handleCool = async (id: string) => {
    const targetPost = posts.find((p) => p.id === id);
    if (!targetPost) return;

    try {
      const postRef = doc(db, 'posts', id);
      await updateDoc(postRef, {
        coolCount: targetPost.coolCount + 1,
      });
      fetchPosts();
    } catch (e) {
      console.error('Cool!更新エラー:', e);
    }
  };

  // Firestore の感想コメント追加
  const handleAddComment = async () => {
    if (!commentPostId || !newCommentText.trim()) return;

    const targetPost = posts.find((p) => p.id === commentPostId);
    if (!targetPost) return;

    const newComment: Comment = {
      id: Date.now().toString(),
      text: newCommentText.trim(),
      createdAt: new Date().toLocaleDateString('ja-JP', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    try {
      const postRef = doc(db, 'posts', commentPostId);
      await updateDoc(postRef, {
        comments: [...targetPost.comments, newComment],
      });
      fetchPosts();
      setNewCommentText('');
    } catch (e) {
      console.error('コメント更新エラー:', e);
    }
  };

  const resetForm = () => {
    setText('');
    setImage(null);
    setGeneratedHaikus([]);
    setSelectedJa('');
    setSelectedEn('');
  };

  const themeStyles = isJapaneseStyle
    ? {
        bg: '#f5f0e6',
        bgTexture: 'repeating-linear-gradient(90deg, rgba(200, 185, 160, 0.12), rgba(200, 185, 160, 0.12) 1px, transparent 1px, transparent 20px)',
        headerBg: '#e8dfd1',
        headerText: '#3a2d27',
        cardBg: '#fffdf9',
        cardBorder: '1px solid #d2c4b0',
        cardFrameTop: '4px double #b58d3d',
        fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", "Georgia", serif',
        primaryColor: '#b83b26',
        secondaryColor: '#1a3644',
        subTextColor: '#5c4d44',
      }
    : {
        bg: '#f8fafc',
        bgTexture: 'none',
        headerBg: '#ffffff',
        headerText: '#0f172a',
        cardBg: '#ffffff',
        cardBorder: '1px solid #e2e8f0',
        cardFrameTop: 'none',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        primaryColor: '#2563eb',
        secondaryColor: '#475569',
        subTextColor: '#334155',
      };

  const activeCommentPost = posts.find((p) => p.id === commentPostId);

  return (
    <div
      translate="no"
      className="notranslate"
      style={{
        minHeight: '100vh',
        backgroundColor: themeStyles.bg,
        backgroundImage: themeStyles.bgTexture,
        fontFamily: themeStyles.fontFamily,
        color: '#1e293b',
        paddingBottom: '80px',
        transition: 'all 0.3s ease',
      }}
    >
      <header
        style={{
          backgroundColor: themeStyles.headerBg,
          borderBottom: '1px solid #dcd2c0',
          padding: '14px 20px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        <div
          style={{
            maxWidth: '640px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <h1 style={{ margin: 0, fontSize: '22px', fontWeight: '800', letterSpacing: '0.5px', color: themeStyles.headerText }}>
            Hi! Cool
          </h1>

          <button
            onClick={() => setIsJapaneseStyle(!isJapaneseStyle)}
            style={{
              padding: '6px 14px',
              borderRadius: '20px',
              border: `1px solid ${themeStyles.primaryColor}`,
              backgroundColor: isJapaneseStyle ? themeStyles.primaryColor : '#ffffff',
              color: isJapaneseStyle ? '#ffffff' : themeStyles.primaryColor,
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            {isJapaneseStyle ? '🌸 和風モード (ON)' : '🌿 洋風モード (OFF)'}
          </button>
        </div>
      </header>

      <main style={{ maxWidth: '640px', margin: '24px auto', padding: '0 16px' }}>
        {posts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
            <p style={{ fontSize: '18px', margin: '0 0 8px 0' }}>まだ投稿がありません。</p>
            <p style={{ fontSize: '14px' }}>右下のボタンから新しい俳句と写真を投稿してみましょう！</p>
          </div>
        ) : (
          posts.map((post) => (
            <div
              key={post.id}
              style={{
                backgroundColor: themeStyles.cardBg,
                borderRadius: isJapaneseStyle ? '8px' : '16px',
                overflow: 'hidden',
                boxShadow: isJapaneseStyle ? '0 4px 16px rgba(58, 45, 39, 0.08)' : '0 4px 12px rgba(0, 0, 0, 0.03)',
                marginBottom: '28px',
                border: themeStyles.cardBorder,
                borderTop: themeStyles.cardFrameTop,
                position: 'relative',
              }}
            >
              <button
                onClick={() => handleDeletePost(post.id)}
                title="投稿を削除"
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  zIndex: 5,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                🗑️
              </button>

              {post.image && (
                <img
                  src={post.image}
                  alt="Post"
                  style={{ width: '100%', maxHeight: '400px', objectFit: 'cover', display: 'block' }}
                />
              )}

              <div style={{ padding: '24px', textAlign: 'center' }}>
                <div style={{ marginBottom: '24px' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      letterSpacing: '2px',
                      color: themeStyles.primaryColor,
                      fontWeight: '700',
                      display: 'block',
                      marginBottom: '12px',
                    }}
                  >
                    JAPANESE HAIKU
                  </span>

                  {isJapaneseStyle ? (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        width: '100%',
                        padding: '12px 0',
                      }}
                    >
                      <div
                        style={{
                          writingMode: 'vertical-rl',
                          fontSize: '22px',
                          fontWeight: 'bold',
                          color: '#2b211b',
                          lineHeight: '2.3',
                          letterSpacing: '4px',
                          width: 'fit-content',
                          margin: '0 auto',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {post.japaneseHaiku.replace(/\s+/g, '\n')}
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        fontSize: '20px',
                        fontWeight: 'bold',
                        color: '#0f172a',
                        lineHeight: '1.5',
                        letterSpacing: '1px',
                      }}
                    >
                      {post.japaneseHaiku}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '20px' }}>
                  <span
                    style={{
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      letterSpacing: '2px',
                      color: themeStyles.primaryColor,
                      fontWeight: '700',
                      display: 'block',
                      marginBottom: '8px',
                    }}
                  >
                    ENGLISH HAIKU
                  </span>
                  <p
                    style={{
                      fontSize: '15px',
                      color: themeStyles.subTextColor,
                      margin: 0,
                      whiteSpace: 'pre-wrap',
                      lineHeight: '1.6',
                      fontStyle: 'italic',
                    }}
                  >
                    {post.englishHaiku}
                  </p>
                </div>

                <div style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'right', marginTop: '16px' }}>
                  {post.createdAt}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginTop: '16px',
                    paddingTop: '16px',
                    borderTop: isJapaneseStyle ? '1px dashed #d2c4b0' : '1px solid #e2e8f0',
                  }}
                >
                  <button
                    onClick={() => handleCool(post.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      backgroundColor: isJapaneseStyle ? '#f0ebd8' : '#eff6ff',
                      color: isJapaneseStyle ? themeStyles.secondaryColor : '#2563eb',
                      border: isJapaneseStyle ? '1px solid #c8bc9e' : '1px solid #bfdbfe',
                      padding: '8px 16px',
                      borderRadius: '20px',
                      fontSize: '14px',
                      fontWeight: '700',
                      cursor: 'pointer',
                    }}
                  >
                    👍 Cool! {post.coolCount > 0 && <span>{post.coolCount}</span>}
                  </button>

                  <button
                    onClick={() => setCommentPostId(post.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      backgroundColor: isJapaneseStyle ? '#fffdf9' : '#f8fafc',
                      color: themeStyles.subTextColor,
                      border: isJapaneseStyle ? '1px solid #d2c4b0' : '1px solid #cbd5e1',
                      padding: '8px 16px',
                      borderRadius: '20px',
                      fontSize: '13px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    💬 感想を見る・書く ({post.comments.length})
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </main>

      <button
        onClick={() => setIsModalOpen(true)}
        style={{
          position: 'fixed',
          bottom: '28px',
          right: '28px',
          backgroundColor: themeStyles.primaryColor,
          color: '#ffffff',
          border: 'none',
          borderRadius: '32px',
          padding: '14px 26px',
          fontSize: '15px',
          fontWeight: '700',
          boxShadow: '0 8px 20px rgba(0,0,0,0.15)',
          cursor: 'pointer',
          zIndex: 90,
        }}
      >
        ＋ 俳句を詠む
      </button>

      {/* 俳句生成・投稿モーダル */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 100,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '20px',
              maxWidth: '560px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '24px',
              position: 'relative',
              boxSizing: 'border-box',
            }}
          >
            <button
              onClick={() => {
                setIsModalOpen(false);
                resetForm();
              }}
              style={{
                position: 'absolute',
                top: '18px',
                right: '18px',
                border: 'none',
                background: 'none',
                fontSize: '22px',
                cursor: 'pointer',
                color: '#64748b',
              }}
            >
              ×
            </button>

            <h2 style={{ marginTop: 0, fontSize: '20px', fontWeight: '700', color: '#0f172a' }}>
              新しい俳句を生成・投稿
            </h2>

            <div style={{ marginBottom: '20px' }}>
              <textarea
                rows={3}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '15px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  boxSizing: 'border-box',
                  outline: 'none',
                }}
                placeholder="出来事や風景、感情を入力（任意）"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <div style={{ marginTop: '12px' }}>
                <input type="file" accept="image/*" onChange={handleImageChange} />
              </div>

              {image && (
                <div style={{ marginTop: '12px', position: 'relative', display: 'inline-block' }}>
                  <img src={image} alt="Preview" style={{ maxHeight: '160px', borderRadius: '10px' }} />
                  <button
                    onClick={() => setImage(null)}
                    style={{
                      position: 'absolute',
                      top: '6px',
                      right: '6px',
                      backgroundColor: 'rgba(0,0,0,0.6)',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '50%',
                      width: '22px',
                      height: '22px',
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </div>
              )}

              <button
                onClick={generateHaiku}
                disabled={loading || (!text && !image)}
                style={{
                  width: '100%',
                  padding: '12px',
                  marginTop: '16px',
                  backgroundColor: loading || (!text && !image) ? '#cbd5e1' : themeStyles.primaryColor,
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '15px',
                  fontWeight: '700',
                  cursor: loading || (!text && !image) ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'AIが俳句を考案中...' : 'AIに俳句を生成させる'}
              </button>
            </div>

            {generatedHaikus.length > 0 && (
              <div style={{ marginTop: '24px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
                <h3 style={{ fontSize: '15px', margin: '0 0 12px 0', color: '#334155' }}>
                  1. 日本語句を選択（4案の中から1つ）
                </h3>
                {generatedHaikus.slice(0, 4).map((haiku, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedJa(haiku)}
                    style={{
                      padding: '12px 14px',
                      border: selectedJa === haiku ? `2px solid ${themeStyles.primaryColor}` : '1px solid #e2e8f0',
                      backgroundColor: selectedJa === haiku ? '#eff6ff' : '#ffffff',
                      borderRadius: '10px',
                      marginBottom: '8px',
                      cursor: 'pointer',
                      fontSize: '15px',
                      fontWeight: selectedJa === haiku ? '700' : '400',
                    }}
                  >
                    {haiku}
                  </div>
                ))}

                <h3 style={{ fontSize: '15px', margin: '18px 0 12px 0', color: '#334155' }}>
                  2. 英語句を選択（3案の中から1つ）
                </h3>
                {generatedHaikus.slice(4, 7).map((haiku, idx) => (
                  <div
                    key={idx}
                    onClick={() => setSelectedEn(haiku)}
                    style={{
                      padding: '12px 14px',
                      border: selectedEn === haiku ? `2px solid ${themeStyles.primaryColor}` : '1px solid #e2e8f0',
                      backgroundColor: selectedEn === haiku ? '#eff6ff' : '#ffffff',
                      borderRadius: '10px',
                      marginBottom: '8px',
                      cursor: 'pointer',
                      fontSize: '14px',
                      whiteSpace: 'pre-wrap',
                      fontWeight: selectedEn === haiku ? '700' : '400',
                    }}
                  >
                    {haiku}
                  </div>
                ))}

                {(selectedJa || selectedEn) && (
                  <div
                    style={{
                      marginTop: '20px',
                      padding: '16px',
                      backgroundColor: '#f8fafc',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                    }}
                  >
                    <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#0f172a' }}>✏️ 選択した句の加筆・修正</h4>

                    <div style={{ marginBottom: '12px' }}>
                      <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700' }}>日本語句の調整:</label>
                      <input
                        type="text"
                        value={selectedJa}
                        onChange={(e) => setSelectedJa(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          marginTop: '4px',
                          fontSize: '15px',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ fontSize: '12px', color: '#64748b', fontWeight: '700' }}>English Haiku の調整:</label>
                      <textarea
                        rows={3}
                        value={selectedEn}
                        onChange={(e) => setSelectedEn(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '10px',
                          marginTop: '4px',
                          fontSize: '14px',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>
                )}

                <button
                  onClick={handlePost}
                  disabled={!selectedJa.trim() || !selectedEn.trim()}
                  style={{
                    width: '100%',
                    padding: '14px',
                    marginTop: '20px',
                    backgroundColor: !selectedJa.trim() || !selectedEn.trim() ? '#cbd5e1' : '#16a34a',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    fontSize: '16px',
                    fontWeight: '700',
                    cursor: !selectedJa.trim() || !selectedEn.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  この内容で投稿する
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 感想（コメント）モーダル */}
      {activeCommentPost && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 100,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '20px',
              maxWidth: '500px',
              width: '100%',
              maxHeight: '80vh',
              display: 'flex',
              flexDirection: 'column',
              padding: '24px',
              position: 'relative',
              boxSizing: 'border-box',
            }}
          >
            <button
              onClick={() => setCommentPostId(null)}
              style={{
                position: 'absolute',
                top: '18px',
                right: '18px',
                border: 'none',
                background: 'none',
                fontSize: '22px',
                cursor: 'pointer',
                color: '#64748b',
              }}
            >
              ×
            </button>

            <h3 style={{ marginTop: 0, fontSize: '18px', fontWeight: '700', color: '#0f172a' }}>
              💬 感想一覧
            </h3>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                margin: '16px 0',
                paddingRight: '8px',
              }}
            >
              {activeCommentPost.comments.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '14px', margin: '30px 0' }}>
                  まだ感想がありません。最初の感想を送信してみましょう！
                </p>
              ) : (
                activeCommentPost.comments.map((c) => (
                  <div
                    key={c.id}
                    style={{
                      backgroundColor: '#f8fafc',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      marginBottom: '10px',
                      border: '1px solid #f1f5f9',
                    }}
                  >
                    <p style={{ margin: 0, fontSize: '14px', color: '#1e293b', lineHeight: '1.5' }}>
                      {c.text}
                    </p>
                    <span style={{ fontSize: '11px', color: '#94a3b8', display: 'block', textAlign: 'right', marginTop: '4px' }}>
                      {c.createdAt}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', gap: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
              <input
                type="text"
                placeholder="作品への感想を入力..."
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  fontSize: '14px',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleAddComment}
                disabled={!newCommentText.trim()}
                style={{
                  backgroundColor: !newCommentText.trim() ? '#cbd5e1' : '#2563eb',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0 18px',
                  fontWeight: '700',
                  fontSize: '14px',
                  cursor: !newCommentText.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                送信
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}