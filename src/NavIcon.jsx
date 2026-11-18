import React from 'react';
import AppstoreOutlined from '@ant-design/icons/es/icons/AppstoreOutlined';
import CreditCardOutlined from '@ant-design/icons/es/icons/CreditCardOutlined';
import GiftOutlined from '@ant-design/icons/es/icons/GiftOutlined';
import WalletOutlined from '@ant-design/icons/es/icons/WalletOutlined';
import LinkOutlined from '@ant-design/icons/es/icons/LinkOutlined';
import BookOutlined from '@ant-design/icons/es/icons/BookOutlined';
import ReadOutlined from '@ant-design/icons/es/icons/ReadOutlined';
import SettingOutlined from '@ant-design/icons/es/icons/SettingOutlined';

// The assistant is the capybara, drawn with the brand mark rather than an antd glyph.
export function CapybaraMark({size = 18, className = ''}) {
  return <span aria-hidden="true" className={`anticon capy-mark ${className}`.trim()}><img src="/brand/zen.svg" alt="" width={size} height={size}/></span>;
}

const ICONS = {
  appstore: AppstoreOutlined,
  'credit-card': CreditCardOutlined,
  gift: GiftOutlined,
  wallet: WalletOutlined,
  link: LinkOutlined,
  book: BookOutlined,
  read: ReadOutlined,
  setting: SettingOutlined,
};

// Icons for the names in navigation.js.
export default function NavIcon({name, size}) {
  if (name === 'capybara') return <CapybaraMark size={size}/>;
  const Icon = ICONS[name];
  return Icon ? <Icon/> : null;
}
