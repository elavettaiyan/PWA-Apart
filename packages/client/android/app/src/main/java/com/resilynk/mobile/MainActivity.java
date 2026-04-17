package com.resilynk.mobile;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	@Override
	public void onCreate(Bundle savedInstanceState) {
		registerPlugin(PhonePePaymentPlugin.class);
		super.onCreate(savedInstanceState);
	}
}